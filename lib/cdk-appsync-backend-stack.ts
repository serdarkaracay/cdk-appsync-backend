
import { Construct } from 'constructs';
import * as dynamodb from '@aws-cdk/aws-dynamodb'
import * as cdk from '@aws-cdk/core';

// import * as sqs from 'aws-cdk-lib/aws-sqs';


const env = { stage:process.env.STAGE, region : process.env.REGION }


export class CdkAppsyncBackendStackX extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string) {
    super(scope, id);

    const tableName = 'CdkUsersTable'
    const table = new dynamodb.Table(this,'CdkUsersTable',{
      tableName:tableName,
      partitionKey : {
        name : id,
        type:dynamodb.AttributeType.NUMBER
      },
      billingMode:dynamodb.BillingMode.PAY_PER_REQUEST,
      sortKey:{ name:id, 
        type:dynamodb.AttributeType.NUMBER
      }
    });

    cdk.Tags.of(this).add("Environment",env.stage!);
    // cdk.Tags.of(this).add("Name","cdkusers-table")
  }
}
