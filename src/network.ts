export const DEFAULT_PORT = 4000;

/**
 * Reads an optional TCP port from command-line arguments. Both `--port 5000`
 * and `5000` are supported to keep direct Node commands concise. When no
 * argument is supplied, a configured fallback is used before the default.
 */
export function parsePortArgument(args: string[], fallbackPort?: string): number {
    if (args.length === 0) {
        if (fallbackPort === undefined) {
            return DEFAULT_PORT;
        }

        return parsePort(fallbackPort);
    }

    const portValue = args.length === 1
        ? args[0]
        : args.length === 2 && args[0] === '--port'
            ? args[1]
            : undefined;

    return parsePort(portValue);
}

function parsePort(portValue: string | undefined): number {
    if (!portValue || !/^\d+$/.test(portValue)) {
        throw new Error('Port must be an integer between 1 and 65535.');
    }

    const port = Number(portValue);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new Error('Port must be an integer between 1 and 65535.');
    }

    return port;
}
