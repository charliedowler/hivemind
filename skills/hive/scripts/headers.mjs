import { bearerToken, endpoint } from './mcp.mjs';

if (process.argv[2]) process.env.HIVE_HOME = process.argv[2];
try {
  const token = await bearerToken(undefined, endpoint(), AbortSignal.timeout(5000));
  console.log(JSON.stringify(token ? { Authorization: `Bearer ${token}` } : {}));
} catch {
  console.log('{}');
}
