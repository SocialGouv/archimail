import type {
    PstContent,
    PstEmail,
    PSTExtractorEmail,
    PstFolder,
    PstProgressState,
} from "@common/modules/pst-extractor/type";
import type { Any } from "@common/utils/type";
import path from "path";
import type { PSTAttachment, PSTFolder } from "pst-extractor";
import { PSTFile } from "pst-extractor";
import { parentPort, workerData } from "worker_threads";

// Events - Worker => Parent
export const PST_PROGRESS_WORKER_EVENT = "pstExtractor.worker.event.progress";
export const PST_DONE_WORKER_EVENT = "pstExtractor.worker.event.done";

interface EventDataMapping {
    [PST_DONE_WORKER_EVENT]: {
        content: PstContent;
        progressState: PstProgressState;
    };
    [PST_PROGRESS_WORKER_EVENT]: PstProgressState;
}

export type PstWorkerEvent = keyof EventDataMapping;

/**
 * Possible message types comming from the worker.
 */
export type PstWorkerMessageType<
    TEvent extends PstWorkerEvent = PstWorkerEvent
> = TEvent extends PstWorkerEvent
    ? {
          event: TEvent;
          data: EventDataMapping[TEvent];
      }
    : never;

/**
 * Post a message to parent thread.
 */
function postMessage<TEvent extends PstWorkerEvent>(
    event: TEvent,
    data: EventDataMapping[TEvent]
): void {
    parentPort?.postMessage({ data, event } as PstWorkerMessageType);
}

/**
 * WorkerData - Initial worker arguments
 */
export interface PstWorkerData {
    pstFilePath: string;
    progressInterval?: number;
    depth?: number;
}

let starTime = Date.now();
let progressInterval = 1000;
let nextTimeTick = starTime;
let definedDepth = Infinity;
let root = true;
let currentDepth = 0;

// ---
// eslint-disable-next-line prefer-const
let DEBUG = true;
// ---

if (parentPort) {
    const {
        pstFilePath,
        progressInterval: pi,
        depth,
    } = workerData as PstWorkerData;
    progressInterval = Math.abs(pi ?? progressInterval);
    definedDepth = Math.abs(depth ?? definedDepth);
    const progressState: PstProgressState = {
        countAttachement: 0,
        countEmail: 0,
        countFolder: 0,
        countTotal: 0,
        elapsed: 0,
        progress: true,
    };

    postMessage(PST_PROGRESS_WORKER_EVENT, progressState);
    const pstFile = new PSTFile(path.resolve(pstFilePath));
    const rootFolder = pstFile.getRootFolder();

    // reset vars
    root = true;
    currentDepth = 0;
    starTime = Date.now();
    nextTimeTick = starTime;
    //

    const content = {
        ...processFolder(rootFolder, progressState),
        type: "rootFolder",
    } as PstContent;
    content.name = pstFile.getMessageStore().displayName;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (DEBUG) {
        (content as Any)._rawJson = rootFolder.toJSON();
    }

    // TODO: postProcess(content); // real email count, ...

    progressState.elapsed = Date.now() - starTime;
    postMessage(PST_DONE_WORKER_EVENT, {
        content,
        progressState,
    });
}

// ---

/**
 * Process a "raw" folder from the PST and extract sub folders, emails, and attachements.
 *
 * The progress state is updated for every item found and sent to any listener on every emails.
 *
 * @param folder The folder to process
 * @param progressState The current progress state to update
 * @returns The extracted content
 */
function processFolder(
    folder: PSTFolder,
    progressState: PstProgressState
): PstFolder {
    const content: PstFolder = {
        name: folder.displayName,
        size: folder.emailCount,
        type: "folder",
    };

    if (DEBUG) {
        try {
            (content as Any)._rawJson = folder.toJSON();
        } catch (error: unknown) {
            (content as Any)._rawJson = { error };
        }
    }

    if (root) {
        root = false;
    } else {
        currentDepth++;
    }

    if (currentDepth <= definedDepth && folder.hasSubfolders) {
        for (const childFolder of folder.getSubFolders()) {
            if (!content.children) {
                content.children = [];
            }
            progressState.countFolder++;
            progressState.countTotal++;
            content.children.push(processFolder(childFolder, progressState));
        }
    }

    if (folder.contentCount) {
        for (const email of folderMailIterator(folder)) {
            if (!content.children) {
                content.children = [];
            }

            const emailContent: PstEmail = {
                cc: email.displayCC.split(";").map((cc) => ({
                    email: "",
                    firstname: "",
                    lastname: "",
                    name: cc,
                    size: 0,
                    type: "contact",
                })),
                children: [],
                contentHTML: email.bodyHTML,
                contentRTF: email.bodyRTF,
                contentText: email.body,
                from: {
                    email: email.senderEmailAddress,
                    firstname: "",
                    lastname: "",
                    name: email.senderEmailAddress,
                    size: 0,
                    type: "contact",
                },
                // TODO: change name
                name: `${email.senderName} ${email.originalSubject}`,
                receivedDate: email.messageDeliveryTime,
                sentTime: email.clientSubmitTime,
                size: 0,
                subject: email.subject,
                to: email.displayTo.split(";").map((to) => ({
                    email: "",
                    firstname: "",
                    lastname: "",
                    name: to,
                    size: 0,
                    type: "contact",
                })),
                type: "email",
            };

            if (DEBUG) {
                (emailContent as Any)._rawJson = (email as Any).toJSON();
            }

            if (email.hasAttachments) {
                emailContent.children = [];
                for (let i = 0; i < email.numberOfAttachments; i++) {
                    const attachement: PSTAttachment = email.getAttachment(i);
                    progressState.countAttachement++;
                    progressState.countTotal++;
                    emailContent.children.push({
                        // TODO: change name
                        name: attachement.displayName,
                        raw: attachement,
                        size: 0,
                        type: "attachement",
                        ...(DEBUG
                            ? {
                                  _rawJson: attachement.toJSON(),
                              }
                            : {}),
                    });
                }
            }
            progressState.countEmail++;
            progressState.countTotal++;
            content.children.push(emailContent);

            // update progress only when interval ms is reached
            const now = Date.now();
            const elapsed = now - nextTimeTick;
            if (elapsed >= progressInterval) {
                progressState.elapsed = now - starTime;
                postMessage(PST_PROGRESS_WORKER_EVENT, progressState);
                nextTimeTick = now;
            }
        }
    }

    return content;
}

function* folderMailIterator(folder: PSTFolder) {
    if (folder.contentCount) {
        let email: PSTExtractorEmail | undefined = folder.getNextChild();
        while (email) {
            yield email;
            email = folder.getNextChild();
        }
    }
}
