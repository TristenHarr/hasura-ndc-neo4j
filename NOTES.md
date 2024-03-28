There have been some changes since we were in Alpha when this connector was first developed.

I have made a few minor changes to get some things working, and also updated the code to reflect the latest version of the Hasura Typescript SDK which is at version `4.2.1`

Here are some of the changes I have made:

In `updateConfiguration.ts` I noticed that the introspection code seemed to be broken.

For some reason types of Duration were not getting picked up, and some tests were failing.

I provided a somewhat quick-n-dirty work around that will generate the types from the genericStruct instead of using `toGraphQLTypeDefs`. This should probably be updated in the neo4j introspection library properly.

The configuration server has been removed from the SDK. What this essentially means is that instead of having a configuration server, there is a script that should introspect the database and spit out the configuration. 

This script should serve as a command that can be passed to the Docker container to run an update. Which then is used for the packaging spec and the CLI.

Please see these RFCs that discuss the implementation of the packaging spec. 

https://github.com/hasura/ndc-hub/tree/main/rfcs

The credentials are no longer stored in the configuration, but instead passed in as environment variables.


