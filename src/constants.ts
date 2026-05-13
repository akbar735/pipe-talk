import { DataFlow } from "./types.js";

// ANSI Color Sequences
export const Black =  '\u001b[30m';
export const Red =  '\u001b[31m';
export const Green =  '\u001b[32m';
export const Yellow =  '\u001b[33m';
export const Blue =  '\u001b[34m';
export const Magenta =  '\u001b[35m';
export const Cyan =  '\u001b[36m';
export const White =  '\u001b[37m';
export const Grey = '\x1b[90m';
export const RESET_COLOR = '\u001b[0m';

// ANSI Style Sequences
export const BOLD = "\u001b[1m";
export const ITALICIZE = "\u001b[3m";
export const UNDERLINE = "\u001b[4m";

export const OPTIONS = `
Available commands
------------------
${Magenta}list users | lu${RESET_COLOR}         ${Grey}->${RESET_COLOR} ${Cyan}Show everyone currently online${RESET_COLOR}
${Magenta}<user>: <message>${RESET_COLOR}       ${Grey}->${RESET_COLOR} ${Cyan}Send a direct message to a user${RESET_COLOR}
${Magenta}<user>: -f <file-path>${RESET_COLOR}  ${Grey}->${RESET_COLOR} ${Cyan}Send a file to a user${RESET_COLOR}
${Magenta}clear | clr${RESET_COLOR}             ${Grey}->${RESET_COLOR} ${Cyan}Clear the terminal screen${RESET_COLOR}

${Grey}Examples${RESET_COLOR}
${Magenta}alex: Hi, are you available for a quick sync?${RESET_COLOR}
${Magenta}alex: -f ./docs/project-brief.pdf${RESET_COLOR}
`
export const greetings = `========================================
 Pipe Talk
========================================
${OPTIONS}
`

// icons code
export const UP_ARROW = '\u2191'
export const DOWN_ARROW = '\u2193'

export const DataFlowIcon = {
    [DataFlow.DOWNLOAD]: DOWN_ARROW,
    [DataFlow.UPLOAD]: UP_ARROW
}
export const DataFlowMessage = {
    [DataFlow.DOWNLOAD]: 'Downloaded',
    [DataFlow.UPLOAD]: 'Uploaded'
}
