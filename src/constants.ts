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
Choose one of the following operations

${Magenta}list users | lu${RESET_COLOR} ${Grey}---->${RESET_COLOR} ${Cyan}(List all online users)${RESET_COLOR}
${Magenta}<userName>:<message>${RESET_COLOR} ${Grey}---->${RESET_COLOR} ${Cyan}(Send message to specific User)${RESET_COLOR}
${Magenta}<userName>:-f <path>${RESET_COLOR} ${Grey}---->${RESET_COLOR} ${Cyan}(Send File/Folder to specific User) ${RESET_COLOR}
${Magenta}clear | clr${RESET_COLOR} ${Grey}---->${RESET_COLOR} ${Cyan}(Clear Screen)${RESET_COLOR}
`
export const greetings = `------------------***----------------------
${OPTIONS}
`