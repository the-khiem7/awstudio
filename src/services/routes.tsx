import type { ReactNode } from "react";
import { dynamoDbPage } from "./dynamodb/DynamoDbPages";
import { eventBridgePage } from "./eventbridge/EventBridgePages";
import { iamPage } from "./iam/IamPages";
import { kmsPage } from "./kms/KmsPages";
import { lambdaPage } from "./lambda/LambdaPages";
import { logsPage } from "./logs/LogsPages";
import { s3Page } from "./s3/S3Pages";
import { secretsManagerPage } from "./secretsmanager/SecretsManagerPages";
import { snsPage } from "./sns/SnsPages";
import { sqsPage } from "./sqs/SqsPages";
import { ssmRoutes } from "./ssm/SsmPages";

/** Services whose console pages exist; every other service shows its support landing page. */
const PAGES: Record<string, (path: string, query: URLSearchParams) => ReactNode | null> = {
  s3: s3Page,
  dynamodb: dynamoDbPage,
  sqs: (path) => sqsPage(path),
  sns: snsPage,
  iam: (path) => iamPage(path),
  lambda: (path) => lambdaPage(path),
  secretsmanager: secretsManagerPage,
  kms: kmsPage,
  ssm: ssmRoutes,
  logs: logsPage,
  eventbridge: eventBridgePage,
};

export function hasServicePages(serviceId: string): boolean {
  return serviceId in PAGES;
}

/** The console page of a service route, or null when the service has no page at that path. */
export function servicePage(serviceId: string, path: string, query: URLSearchParams): ReactNode | null {
  return PAGES[serviceId]?.(path, query) ?? null;
}
