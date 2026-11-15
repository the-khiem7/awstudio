// The services with console pages in this app. `capability` is the service key of
// `capability.json` (the slug of the SDK id); `path` is the console URL path the routes mirror.

export interface ConsoleService {
  id: string;
  /** Short name as the console's services menu shows it. */
  title: string;
  description: string;
  category: string;
  capability: string;
  path: string;
  keywords: string[];
}

export const SERVICES: ConsoleService[] = [
  {
    id: "s3",
    title: "S3",
    description: "Scalable Storage in the Cloud",
    category: "Storage",
    capability: "s3",
    path: "/s3",
    keywords: ["bucket", "object", "storage"],
  },
  {
    id: "dynamodb",
    title: "DynamoDB",
    description: "Managed NoSQL Database",
    category: "Database",
    capability: "dynamodb",
    path: "/dynamodbv2",
    keywords: ["table", "nosql", "partiql", "item"],
  },
  {
    id: "sqs",
    title: "Simple Queue Service",
    description: "Managed Message Queues",
    category: "Application Integration",
    capability: "sqs",
    path: "/sqs",
    keywords: ["sqs", "queue", "message", "fifo"],
  },
  {
    id: "sns",
    title: "Simple Notification Service",
    description: "SNS managed message topics for Pub/Sub",
    category: "Application Integration",
    capability: "sns",
    path: "/sns",
    keywords: ["sns", "topic", "subscription", "publish"],
  },
  {
    id: "eventbridge",
    title: "Amazon EventBridge",
    description: "Serverless service for building event-driven applications",
    category: "Application Integration",
    capability: "eventbridge",
    path: "/events",
    keywords: ["events", "rule", "event bus", "cloudwatch events"],
  },
  {
    id: "lambda",
    title: "Lambda",
    description: "Run code without thinking about servers",
    category: "Compute",
    capability: "lambda",
    path: "/lambda",
    keywords: ["function", "serverless"],
  },
  {
    id: "iam",
    title: "IAM",
    description: "Manage access to AWS resources",
    category: "Security, Identity, & Compliance",
    capability: "iam",
    path: "/iam",
    keywords: ["user", "role", "policy", "group", "identity"],
  },
  {
    id: "secretsmanager",
    title: "Secrets Manager",
    description: "Easily rotate, manage, and retrieve secrets throughout their lifecycle",
    category: "Security, Identity, & Compliance",
    capability: "secrets-manager",
    path: "/secretsmanager",
    keywords: ["secret", "rotation", "password"],
  },
  {
    id: "kms",
    title: "Key Management Service",
    description: "Securely Generate and Manage AWS Encryption Keys",
    category: "Security, Identity, & Compliance",
    capability: "kms",
    path: "/kms",
    keywords: ["kms", "key", "encryption", "alias"],
  },
  {
    id: "ssm",
    title: "Systems Manager",
    description: "Gain operational insights and take action on AWS resources",
    category: "Management & Governance",
    capability: "ssm",
    path: "/systems-manager",
    keywords: ["ssm", "parameter store", "parameter", "run command", "automation", "opscenter"],
  },
  {
    id: "logs",
    title: "CloudWatch Logs",
    description: "Monitor, store, and access log files",
    category: "Management & Governance",
    capability: "cloudwatch-logs",
    path: "/cloudwatch/logs",
    keywords: ["log group", "log stream", "logs insights", "cloudwatch"],
  },
];

export const CATEGORIES = [...new Set(SERVICES.map((s) => s.category))];

export function serviceById(id: string): ConsoleService | undefined {
  return SERVICES.find((s) => s.id === id);
}

/** The service whose console path the route path starts with. */
export function serviceForPath(path: string): ConsoleService | undefined {
  return SERVICES.find((s) => path === s.path || path.startsWith(`${s.path}/`));
}

/** Services whose title, description or keywords contain every word of the query. */
export function searchServices(query: string): ConsoleService[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return SERVICES;
  return SERVICES.filter((s) => {
    const text = [s.title, s.description, s.id, ...s.keywords].join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
