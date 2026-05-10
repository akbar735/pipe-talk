import { Socket } from "node:net";

export type AskQuestion = (query: string, onAnswer: (answer:string) => void) => void;

export enum Type{
    FEEDABCK = 'feedback',
    ID = 'id',
    SERVER_RESPONSE = 'server-response',
    CLIENT_RESPONSE = 'client-response',
    LIST_USERS = 'list-users',
    SEND_TO = 'send-to',
    SEND_FILE = 'send-file',
    RECIEVE_FILE = 'recieve-file'

}

export interface IMessage{
    type: Type;
    msg?: string;
    userId?: string;
    to?: string;
    from?: string;
    data?: string;
    fileId?: string;
    fileName?: string;
    seq?: number;
    fileSize?: number;
    bytes?: number;
    currentTotalBytes?: number;
}

export interface ISocketExtended extends Socket{
    userId?: string;
}

export enum Command{
    LU = 'lu',
    LIST_USERS = 'list users',
    CLEAR = 'clear',
    CLR = 'clr',
}

export enum DataFlow{
    DOWNLOAD = 'download',
    UPLOAD = 'upload'
}