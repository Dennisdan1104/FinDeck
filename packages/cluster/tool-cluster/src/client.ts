/**
 * Client-namespace projection of the cluster tool's public types: a pure
 * re-export of the package's types outlet. Client code imports only the client
 * namespace (repo discipline), so `./client` serves the same single-source
 * content `./types` serves to host consumers — no duplication.
 *
 * @module @deepseek-ai/dsh-tool-cluster/client
 */

export type * from './types.ts'
