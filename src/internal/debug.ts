import util from "util"

export const LogLevel = {
    Debug: 0,
    Info: 1,
    Warn: 2,
    Error: 3
}

// LogType:
//     - console: Log to the console, we first use debugFormat to format object before logging so that we could see all the content in the console.
//     - browser: Log to the browser, we directly log since the embedded console in the browser can expand the object automatically.
export type LogType = "console" | "browser";

export let DEFAULT_LOG_TYPE: LogType = "console";
export let DEFAULT_LOG_LEVEL: number = 1;

export const changeDefaultLogType = (logType: LogType) => {
    DEFAULT_LOG_TYPE = logType;
}

export const changeDefaultLogLevel = (logLevel: number) => {
    DEFAULT_LOG_LEVEL = logLevel;
}

// From: https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
export const debugFormat = (s: any) => {
    const t = typeof s;
    if (t === "string" || t === "number" || t === "bigint") {
        return s;
    }
    return util.inspect(s, {showHidden: false, depth: null, colors: false});
}

const log = (level: number, s: any, title: string | null = null) => {
    if (level < DEFAULT_LOG_LEVEL) {
        return;
    }

    if (DEFAULT_LOG_TYPE === "console") {
        const detail = debugFormat(s);
        if (title !== null) {
            console.log(`[${title}]:\n${detail}`);
        }
        else {
            console.log(detail);
        }
    }
    else {
        if (title !== null) {
            console.log(`[${title}]:\n`, s);
        }
        else {
            console.log(s);
        }
    }
    
}

export const debugLog = (s: any, title: string | null = null) => { log(LogLevel.Debug, s, title) }
export const infoLog = (s: any, title: string | null = null) => { log(LogLevel.Info, s, title) }
export const warnLog = (s: any, title: string | null = null) => { log(LogLevel.Warn, s, title) }
export const errorLog = (s: any, title: string | null = null) => { log(LogLevel.Error, s, title) }