import { Configuration, ConfigurationSchema } from "./src";
import { BASE_TYPES, assertTypeNameIsRestricted } from "./src/constants";
import {
  getNeo4jDriver,
  inferRelationshipFieldName,
  toPlural,
} from "./src/utilities";
import { toGenericStruct, toGraphQLTypeDefs } from "@neo4j/introspector";
import { Neo4jStruct } from "@neo4j/introspector/dist/types";
import Property from "@neo4j/introspector/dist/classes/Property";
// @ts-ignore
import { ObjectField, Type } from "@hasura/ndc-sdk-typescript";
import { Neo4jGraphQL } from "@neo4j/graphql";
import * as fs from "fs";
import { promisify } from "util";
const writeFile = promisify(fs.writeFile);
const NEO4J_URL = process.env["NEO4J_URL"] as string;
let NEO4J_USER = process.env["NEO4J_USER"] as string | undefined;
if (NEO4J_USER === undefined){
  NEO4J_USER = "";
}
let NEO4J_PASS = process.env["NEO4J_PASS"] as string | undefined;
if (NEO4J_PASS === undefined){
  NEO4J_PASS = "";
}

/**
 * Some Notes involving the schema modelling..
 * The connector does need to handle it's own introspection
 * The config should be immutable and provided on startup.
 * There will be an update command that will perform introspection and write the config to a mounted volume.
 * 
 */

/**
 * This is a fallback of the default mechanism of getting the data through the configuration object.
 * Assuming there will be an UI in Hasura for schema modelling, the configuration object should be used at all times.
 * For testing purposes, this function provides a DB introspection mechanism as a fallback, so that queries can be run against any data in the DB.
 *
 * @param {Configuration} configuration - A possibly empty configuration. If not empty, the same one should be returned.
 * @returns {Promise<Configuration>} - An updated configuration to reflect the data present in the DB
 */
export async function doUpdateConfiguration(
  configuration: Configuration
): Promise<Configuration> {
  // if (configuration.config) {
  //   // TODO: fix tests (they start with config but I removed logic to make schema from config)
  //   return configuration;
  // }

  const driver = getNeo4jDriver({neo4j_url: NEO4J_URL, neo4j_user: NEO4J_USER as string, neo4j_pass: NEO4J_PASS as string});
  // There seems to be an error with the toGraphQLTypeDefs, in that it is correct for all types except for screenTime which is a Duration
  // When you replace the typeDefs with a hard-coded typeDefs with Duration like this:
  // const typeDefs = "type Actor {\n    id: Int!\n    livesIn: Point!\n    bornIn: Point!\n    name: String!\n}\n\ntype Movie {\n    releasedIn: DateTime!\n    size: String!\n    releasedInLocal: LocalDateTime!\n    year: String!\n    screenTime: Duration!\n    isPublic: Boolean!\n    id: Int!\n    time: Time!\n    title: String!\n    timeLocal: LocalTime!\n}\n\n";
  // The correct neoSchema is generated.
  // const typeDefs = await toGraphQLTypeDefs(() => driver.session());

  // As a work-around for now I will generate the type-defs by hand.
  const genericStruct = await toGenericStruct(() => driver.session());
  let typeDefs = "";

  for (let [_, value] of Object.entries(genericStruct.nodes)) {
      // Using the type label as the GraphQL type name
      const typeName = value.labels[0]; // Assuming the first label is the type name
      let typeBody = `type ${typeName} {\n`;
  
      // Add each property as a field in the type definition
      for (let prop of value.properties) {
          const propName = prop.name;
          // Here, we directly use the first type in the types array without conversion
          let propType = prop.types[0]; // Taking the first type as is

          // This isn't quite perfect either, as the Long type gets converted to an Int.
          // This could probably be handled by adding a Long to the scalar types and updating the relevant logic?
          if (propType === "Long"){
            propType = "Int";
          }
          const mandatory = prop.mandatory ? "!" : "";
  
          typeBody += `    ${propName}: ${propType}${mandatory}\n`;
      }
  
      typeBody += "}\n\n";
      typeDefs += typeBody;
  }
  // console.log("typeDefs", typeDefs);
  // const typeDefs = "type Actor {\n\tbornIn: Point!\n\tid: BigInt!\n\tlivesIn: Point!\n\tname: String!\n}\n\ntype Movie {\n\tid: BigInt!\n\tisPublic: Boolean!\n\treleasedIn: DateTime!\n\treleasedInLocal: LocalDateTime!\n\tscreenTime: String!\n\tsize: String!\n\ttime: Time!\n\ttimeLocal: LocalTime!\n\ttitle: String!\n\tyear: String!\n}";
  const neo4jGQL = new Neo4jGraphQL({
    typeDefs,
    driver,
  });
  const neoSchema = await neo4jGQL.getSchema();
  configuration.typedefs = typeDefs;
  configuration.neoSchema = neoSchema;

  // TODO: result of toGenericStruct may differ from what toGraphQLTypeDefs used to generate the typedefs string
  // ideally change the introspector to return typedefs and also the struct it used to generate them
  console.log("genericStruct", genericStruct);
  const collectionNames = Object.values(genericStruct.nodes)
    .map((n) => n.labels[0])
    .map(toPlural);

  for (const label of collectionNames) {
    if (assertTypeNameIsRestricted(label)) {
      throw new Error(`${label} is a restricted name!`);
    }
  }

  configuration.config = {
    collection_names: collectionNames,
    object_types: { ...BASE_TYPES },
    foreign_keys: {},
    uniqueness_constraints: {},
    object_fields: {},
    functions: [],
    procedures: [],
  };
  genericStructToHasuraConfig(genericStruct, configuration.config);

  return configuration;
}

type NodeInfo = {
  k: string;
  labels: string[];
  mainLabel: string;
  properties: Property[];
};

type RelationshipInfo = {
  fromType: NodeInfo;
  toType: NodeInfo;
  properties: Property[];
  type: string;
  fieldName: string;
};
function genericStructToHasuraConfig(
  genericStruct: Neo4jStruct,
  config: ConfigurationSchema
): void {
  const { nodes: introspectedNodes, relationships: introspectedRelationships } =
    genericStruct;
  const nodesMap = Object.entries(introspectedNodes).reduce<
    Record<string, NodeInfo>
  >((acc, [k, node]) => {
    acc[k] = {
      k,
      labels: node.labels,
      mainLabel: node.labels[0], // TODO: Assumption - generated query (the collection) will be named using the first label only
      properties: node.properties,
    };
    return acc;
  }, {});
  for (const k in nodesMap) {
    const node = nodesMap[k];
    const nodeMainLabel = node.mainLabel;
    console.log("label", nodeMainLabel);
    const fields = propertiesToHasuraField(node.properties);
    console.log("fields", fields);
    config.object_types[nodeMainLabel] = {
      description: null,
      fields: Object.fromEntries(fields.entries()),
    };
    config.object_fields[nodeMainLabel] = Array.from(fields.keys());
  }

  const relationships = Object.entries(
    introspectedRelationships
  ).flatMap<RelationshipInfo>(([_, rel]) => {
    // TODO: Assumption - all relationships are traversable from both directions
    let relationshipsInBothDirection = rel.paths.flatMap<RelationshipInfo>(
      (p) => {
        const fromType = nodesMap[p.fromTypeId];
        const toType = nodesMap[p.toTypeId];
        return [
          {
            fromType,
            toType,
            properties: rel.properties,
            type: rel.type,
            fieldName: inferRelationshipFieldName(
              rel.type,
              fromType?.mainLabel as string,
              toType?.mainLabel as string,
              "OUT"
            ), // typenames can differ from what introspector generated in type defs
          },
          {
            fromType: toType,
            toType: fromType,
            properties: rel.properties,
            type: rel.type,
            fieldName: inferRelationshipFieldName(
              rel.type,
              fromType?.mainLabel as string,
              toType?.mainLabel as string,
              "IN"
            ), // typenames can differ from what introspector generated in type defs
          },
        ];
      }
    );
    return relationshipsInBothDirection;
  });
  for (const rel of relationships) {
    if (!rel.fromType || !rel.toType) {
      throw Error("could not find fromType toType");
    }

    // TODO: keys should be fields with Unique constraint if it exists
    const fromTypeKey = config.object_fields[rel.fromType.mainLabel][0];
    const toTypeKey = config.object_fields[rel.toType.mainLabel][0];

    config.foreign_keys[rel.fromType.mainLabel] = {
      ...config.foreign_keys[rel.fromType.mainLabel],
      [rel.fieldName]: {
        foreign_collection: toPlural(rel.toType.mainLabel),
        column_mapping: { [fromTypeKey]: toTypeKey },
      },
    };
  }
}

function propertiesToHasuraField(
  properties: Property[]
): Map<string, ObjectField> {
  const wrapNull = (x: Type): Type => ({
    type: "nullable",
    underlying_type: x,
  });
  console.log(properties);
  const fields = new Map<string, ObjectField>();
  for (const property of properties) {
    let fieldType: Type | undefined;
    // TODO: Assumption - takes only first item
    const propertyType = property.types[0];
    // TODO: Assumption - all Longs are Ints
    const renamedPropertyType = propertyType.includes("Long")
      ? propertyType.replace("Long", "Int")
      : propertyType;

    // TODO: Assumption - introspector generates properties with types ending in Array for arrays
    if (renamedPropertyType.endsWith("Array")) {
      fieldType = {
        type: "array",
        element_type: {
          type: "named",
          name: renamedPropertyType.split("Array")[0],
        },
      };
    } else {
      fieldType = {
        type: "named",
        name: renamedPropertyType,
      };
    }

    if (!property.mandatory) {
      fieldType = wrapNull(fieldType);
    }
    fields.set(property.name, {
      description: null,
      type: fieldType,
    });
  }
  return fields;
}

async function main() {
    const configuration: Configuration = {};
    console.log("DOING UPDATE");
    const newConfig = await doUpdateConfiguration(configuration);
    console.log("CONFIG");
    console.log(newConfig);
    await writeFile("/etc/connector/config.json", JSON.stringify(newConfig));
    process.exit(0);
}

main();