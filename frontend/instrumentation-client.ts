import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
  // Sentry SDK v11 defaults to collecting more request data than v10.
  // Keep user details, cookies, bodies, database payloads and queue contents out.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: {
      request: { deny: ["forwarded", "-ip", "remote-", "via", "-user", "authorization", "cookie"] },
      response: { deny: ["set-cookie", "authorization"] },
    },
    httpBodies: [],
    urlQueryParams: { deny: ["ticket", "code", "state", "token", "authorization"] },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
  },
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
});
