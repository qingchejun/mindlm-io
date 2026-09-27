#!/usr/bin/env node
/**
 * Placeholder entry point. The real CLI (serve / demo / text / url / pdf /
 * export / doctor) and the MCP stdio server land in the next change; this keeps
 * `bin` resolvable and the build honest in the meantime.
 */
import { VERSION } from './util/version.js';

process.stderr.write(`mindlm-mcp ${VERSION}: the command line interface is not wired up yet.\n`);
process.exit(1);
