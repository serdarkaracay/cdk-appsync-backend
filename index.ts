import * as appsync from "@aws-cdk/aws-appsync-alpha";
import { App, CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { UserPoolClient } from "aws-cdk-lib/aws-cognito";
// import { AttributeType, BillingMode, CfnTable, StreamViewType, Table } from 'aws-cdk-lib/aws-appsync';
import {
  Table,
  AttributeType,
  StreamViewType,
  BillingMode,
  CfnTable,
} from "aws-cdk-lib/aws-dynamodb";
import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { table } from "console";
import { Construct } from "constructs";
import * as path from "path";

require("dotenv").config();

const env = {
  account: process.env.ACCOUNT,
  stage: process.env.STAGE,
  region: process.env.REGION,
};

export class CdkAppsyncBackendStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    const tableName = "CdkUserTable";

    const itemsTable = new Table(this, "ItemsTable", {
      tableName: tableName,
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    const confirmUserSignupLambdaFunction = new lambda.Function(
      this,
      "ConfirmUserSignupLambdaFunction",
      {
        runtime: lambda.Runtime.NODEJS_12_X,
        handler: "functions/confirm-user-signup.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "functions/")),
        functionName: "cdk-appsync-backend-dev-confirmUserSignup",
        memorySize: 1024,
        timeout: Duration.minutes(6),
      }
    );

    confirmUserSignupLambdaFunction.addEnvironment("STAGE", env.stage!);
    confirmUserSignupLambdaFunction.addEnvironment(
      "AWS_NODEJS_CONNECTION_REUSE_ENABLED",
      "1"
    );

    const cfnTable = itemsTable.node.defaultChild as CfnTable;

    confirmUserSignupLambdaFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["dynamodb:PutItem"],
        resources: [cfnTable.attrArn],
      })
    );
    

    const principal = new ServicePrincipal("cognito-idp.amazonaws.com");
    confirmUserSignupLambdaFunction.grantInvoke(principal);

    const userPool = new cognito.UserPool(this, "cdk-userpool", {
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireSymbols: false,
        requireDigits: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      customAttributes: {
        name: new cognito.StringAttribute({ mutable: true }),
      },
      lambdaTriggers: {
        postConfirmation: confirmUserSignupLambdaFunction,
      },
    });

    confirmUserSignupLambdaFunction.addPermission(
      "UserPoolInvokeConfirmUserSignupLambdaPermission",
      {
        principal: principal,
        action: "lambda:InvokeFunction",
        sourceArn: userPool.userPoolArn,
      }
    );

    confirmUserSignupLambdaFunction.addEnvironment(
      "COGNITO_USER_POOL_ID",
      userPool.userPoolId
    );

    const cfnUserPool = userPool.node.defaultChild as cognito.CfnUserPool;

    cfnUserPool.lambdaConfig = {
      postConfirmation: "ConfirmUserSignupLambdaFunction",
    };

    cfnUserPool.schema = [
      {
        attributeDataType: "String",
        name: "name",
        required: false,
        mutable: true,
      },
    ];

    const userPoolClient = new cognito.UserPoolClient(this, "cdkUserPoolClient", {
      userPool: userPool,
    });

    const cfnUserPoolClient = userPoolClient.node
      .defaultChild as cognito.CfnUserPoolClient;

    cfnUserPoolClient.userPoolId = userPool.userPoolId;
    cfnUserPoolClient.clientName = "web";
    cfnUserPoolClient.explicitAuthFlows = [
      "ALLOW_USER_SRP_AUTH",
      "ALLOW_USER_PASSWORD_AUTH",
      "ALLOW_REFRESH_TOKEN_AUTH",
    ];
    cfnUserPoolClient.preventUserExistenceErrors = "ENABLED";

    const api = new appsync.GraphqlApi(this, "cdk-appsync-backend", {
      name: "cdk-appsync-backend",
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ALL,
      },
      schema: appsync.Schema.fromAsset("schema.api.graphql"),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: userPool,
            defaultAction: appsync.UserPoolDefaultAction.ALLOW,
          },
        },
      },
      xrayEnabled: false,
    });
    api.addNoneDataSource("cdk-ApiNoneDS", {
      name: "none",
    });

    const dsApi = api.addDynamoDbDataSource("cdk-ApiDynmDS", itemsTable);

    dsApi.createResolver({
      typeName: "Query",
      fieldName: "getMyProfile",
      requestMappingTemplate: appsync.MappingTemplate.dynamoDbGetItem(
        "id",
        "username"
      ),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    new CfnOutput(this, "userPoolId", {
      value: userPool.userPoolId,
    });
    new CfnOutput(this, "userPoolClientId", {
      value: userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, "AwsRegion", {
      value: env.region!,
    });
  }
}

const app = new App();
new CdkAppsyncBackendStack(app, "CdkAppsyncBackendStack", {
  env: env,
});
app.synth();
