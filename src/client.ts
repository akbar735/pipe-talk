import net, { type Socket } from 'node:net';
import readline from 'node:readline';
import { Cyan, RESET_COLOR } from './constants.js';
import { createMessageParser } from './helper.js';
import {
    createClientHandlerState,
    handleClientMessage,
    handleClientSocketClose,
    handleClientSocketConnect,
    handleClientSocketEnd,
    handleClientSocketError
} from './client-request-handlers.js';
import { type AskQuestion, type IMessage } from './types.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const connectionOptions = {
    host: '192.168.1.3',
    port: 4000
};

type ClientPromptState = {
    activeQuestionController: AbortController | null;
};

const clientState: ClientPromptState = {
    activeQuestionController: null
};

const clientHandlerState = createClientHandlerState();

function clearActiveQuestion() {
    if (!clientState.activeQuestionController) {
        return;
    }

    clientState.activeQuestionController.abort();
    clientState.activeQuestionController = null;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
}

const askQuestion: AskQuestion = (query, onAnswer) => {
    clearActiveQuestion();
    clientState.activeQuestionController = new AbortController();

    rl.question(query, { signal: clientState.activeQuestionController.signal }, (answer) => {
        onAnswer(answer);
    });
};

function connectToServer() {
    const socket = net.createConnection(connectionOptions);
    registerSocketEvents(socket);
}

function askRetryQuestion() {
    askQuestion(Cyan + 'Enter try to Retry Connection\n' + RESET_COLOR, (answer) => {
        if (answer.trim().toLowerCase() === 'try') {
            connectToServer();
            return;
        }

        askRetryQuestion();
    });
}

function registerSocketEvents(activeSocket: Socket) {
    const handleMessage = createMessageParser((parsed: IMessage) => {
        handleClientMessage(clientHandlerState, askQuestion, activeSocket, parsed);
    });

    activeSocket.on('data', handleMessage);
    activeSocket.on('error', handleClientSocketError);
    activeSocket.on('connect', handleClientSocketConnect);
    activeSocket.on('end', () => {
        handleClientSocketEnd(clientHandlerState, clearActiveQuestion);
    });
    activeSocket.on('close', () => {
        handleClientSocketClose(clientHandlerState, clearActiveQuestion, askRetryQuestion);
    });
}

connectToServer();
