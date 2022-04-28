
import { CancellationToken, Disposable, Event, EventEmitter, FileDecoration, FileDecorationProvider, ThemeColor, Uri, window, workspace } from "vscode";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class TreeItemDecorationProvider implements Disposable {

    private _onDidChangeFileDecorations: EventEmitter<Uri | Uri[] | undefined> = new EventEmitter<Uri | Uri[] | undefined>();
    onDidChangeFileDecorations?: Event<Uri | Uri[] | undefined> | undefined = this._onDidChangeFileDecorations.event;

    private readonly disposable: Disposable;

    constructor() {
        this.disposable = Disposable.from(
            // Register a separate file decoration provider to indicate the
            // number of already checked out files for this archive
            //
            // Note we we can only have 2 char's per decoration
            window.registerFileDecorationProvider({
                onDidChangeFileDecorations: this.onDidChangeFileDecorations,

                provideFileDecoration: (uri, token) => {
                    return this.provideCheckedOutCounter(uri, token);   
                }
            }),
            window.registerFileDecorationProvider({
                onDidChangeFileDecorations: this.onDidChangeFileDecorations,

                provideFileDecoration: (uri, token) => {
                    return this.provideCheckedOutHint(uri, token);   
                }
            }),
            window.registerFileDecorationProvider({
                onDidChangeFileDecorations: this.onDidChangeFileDecorations,
                
                provideFileDecoration: (uri, token) => {
                    return this.provideAvailableFilesCount(uri, token);   
                }
            })
        );
    }

    dispose(): void {
        this.disposable.dispose();
    }

    provideAvailableFilesCount(uri: Uri, token: CancellationToken): FileDecoration | undefined {
        if (uri.scheme === 'archive') {
            // 74921461-086f-42a5-92a8-7acda18b1f28
            const uuid = uri.authority;
            // /true
            const hasFiles = uri.path.substring(1) === 'true';
            // count=1
            const count = uri.query.split('=')[1];

            if (!hasFiles) {
                return {
                    color: new ThemeColor('sideBarSectionHeader.border'),
                    propagate: true
                };
            }
            return {
                badge: count
            };
        }

        return undefined;
    }

    provideCheckedOutHint(uri: Uri, token: CancellationToken): FileDecoration | undefined {
        if (uri.scheme === 'file') {
            const config = workspace.getConfiguration("testtreeview");
            const workspaceLoc = config.get<string>("workspace.path") || os.homedir();

            const archiveId = uri.authority;
            const fileUuid = uri.path.substring(1);
            const fileName = uri.query.split("=")[1];

            const _path = path.join(workspaceLoc, archiveId, fileName + ".txt");

            if (fs.existsSync(_path)) {
                return {
                    badge: 'CO',
                    color: new ThemeColor('merge.currentHeaderBackground'),
                    tooltip: 'Checked-Out'
                };
            } else {
                return undefined;
            }

        }

        return undefined;
    }

    provideCheckedOutCounter(uri: Uri, token: CancellationToken): FileDecoration | undefined {
        if (uri.scheme !== 'archive') {
            return undefined;
        }

        const config = workspace.getConfiguration("testtreeview");
        const workspaceLoc = config.get<string>("workspace.path") || os.homedir();
        const uuid = uri.authority;

        const archiveLoc = path.join(workspaceLoc, uuid);
        if (fs.existsSync(archiveLoc)) {
            const count = fs.readdirSync(archiveLoc).length;
            return {
                badge: `${count}`,
                color: new ThemeColor('merge.currentHeaderBackground'),
                tooltip: 'Checked-Out',
                propagate: true
            };
        }
        return undefined;
    }

    public updateDecoration(uri: Uri): void {
        this._onDidChangeFileDecorations.fire(uri);
    }
}
