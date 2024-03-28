import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { Driver } from "neo4j-driver";
import { getNeo4jDriver } from "../src/utilities";
import { Credentials } from "../src";
const NEO4J_URL = "neo4j://localhost:7687/neo4j";
const NEO4J_PASS = "";
const NEO4J_USER = "";
describe("API Tests", () => {
  const baseDir = path.resolve(__dirname, "./requests");
  const dataFile = path.resolve(__dirname, "./data/data.json");
  const configurationFile = path.resolve(
    __dirname,
    "./data/config.json"
  );
  const testDirs: string[] = [
    path.resolve(baseDir, "movies"),
    // path.resolve(baseDir, "actors"), Hasura does not seem to support nested fields, Point and CartesianPoint are nested
  ];
  let driver: Driver | undefined = undefined;

  async function loadDataFromFile(filePath: string) {
    const data = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(data);
  }

  async function setupDatabase() {
    console.log("SETTING UP DATABASE");
    const configuration = await loadDataFromFile(configurationFile);
    const data = await loadDataFromFile(dataFile);
    const createStatements = [];
    for (const label in data) {
      const nodesForLabel: Record<string, any>[] = data[label];
      for (const node of nodesForLabel) {
        const nodeFields = Object.entries(node).map(([fieldName, value]) => {
          const fieldType =
            configuration.config.object_types[label].fields[fieldName].type
              .name;
          if (["String", "ID", "Date", "BigInt"].includes(fieldType)) {
            return `${fieldName}: "${value}"`;
          }
          return `${fieldName}: ${value}`;
        });
        createStatements.push(`CREATE (:${label} {${nodeFields.join(", ")}})`);
      }
    }
    try {
      const insertQuery = createStatements.join("\n");
      console.log("executing query", insertQuery);
      const creds: Credentials = {neo4j_url: NEO4J_URL, neo4j_pass: NEO4J_PASS, neo4j_user: NEO4J_USER};
      driver = getNeo4jDriver(creds);
      await driver.executeQuery(insertQuery);
    } catch (err) {
      console.error("error:", err);
      throw new Error(`Error while db set-up: ${err}`);
    }
  }

  beforeAll(async () => {
    // await setupDatabase();
  });

  afterAll(async () => {
    // if (!driver) {
    //   console.log("Cannot find driver. Unable to cleanup.");
    //   return;
    // }
    // const configuration = await loadDataFromFile(configurationFile);

    // for (const label of configuration.config.collection_names) {
    //   const individualCollectionName: string = label.slice(0, -1);
    //   await driver.executeQuery(
    //     `MATCH (n: ${individualCollectionName}) DETACH DELETE n`
    //   );
    // }
  });

  testDirs.forEach((testDir) => {
    describe(`Testing directory: ${testDir}`, () => {
      const files = fs.readdirSync(testDir);
      const testCases = files.map((file) => {
        const filePath = path.join(testDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const { method, url, request, response } = JSON.parse(content);
        return { filePath, method, url, request, response };
      });

      test.each(testCases)(
        "Testing %s",
        async ({ filePath, method, url, request, response }) => {
          //   try {
          const apiResponse = await axios({
            method,
            url: `http://127.0.0.1:8084/${url}`,
            data: request,
          });
          console.log(JSON.stringify(apiResponse.data, null, 4));
          expect(apiResponse.data).toEqual(response);
          //   } catch (err) {
          //     console.error(
          //       "apiRequest error",
          //       (err as any).response.data.details
          //     );
          //   }
        }
      );
    });
  });
});
