/* eslint-disable @typescript-eslint/naming-convention */
import { commands, Disposable, Event, EventEmitter, ExtensionContext, MarkdownString, ProviderResult, TextDocument, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, workspace } from "vscode";
import { randomUUID } from "crypto";
import { FilterPanel } from "./filterPanel";

let idx = 0;

// ////////////////////////////////////////////////////////////////////////////
// Domain classes
// ////////////////////////////////////////////////////////////////////////////

class Archive {

    uuid: string = randomUUID();
    internalId: number = idx++;
    title: string = `Archive ${this.internalId}`;
    description: string = "Lorem Ipsum";
    lastUpdated: string = new Date().toISOString();
    files: FilesContainer | undefined;
    hasDownloadableContent: boolean;

    constructor() {
        this.hasDownloadableContent = Boolean(Math.round(Math.random()));
        if (this.hasDownloadableContent) {
            const files: File[] = [];
            let fileIdx = 1;
            const rnd = Math.round(Math.random() * 5);
            for (let i = 0; i < rnd; i++) {
                const file = new File(fileIdx++);
                files.push(file);
            }
            this.files = new FilesContainer(files);
        }
    }
}

class File {

    public readonly uuid: string = randomUUID();
    public name: string;
    // fake content
    public readonly content: string = Math.random().toString(36).slice(2, 7);

    constructor(idx: number) {
        this.name = `File ${idx++}`;
    }
}

class Filter {

    constructor(
        public readonly term?: string,
        public readonly hasFiles?: boolean
    ) {

    }

}

// ////////////////////////////////////////////////////////////////////////////
// Domain helper classes
// ////////////////////////////////////////////////////////////////////////////

// helper class to represent description content as child of archives in the
// tree
class Description {

    constructor(public readonly description: string) {

    }
}

// Adding File[] to the generic array definition will lead to vscode adding
// each file as child of archive instead of an intermediary node. This helper
// class represents the intermediary node
class FilesContainer {

    constructor(public files: File[]) {

    }
}

// artifical class to indicate that more data is available to load
class LoadMore {
    constructor(public readonly page: number) {

    }
}

// ////////////////////////////////////////////////////////////////////////////
// Tree item definitions
// ////////////////////////////////////////////////////////////////////////////

class ArchiveNode extends TreeItem {

    constructor(public readonly data: Archive) {
        super(data.title, TreeItemCollapsibleState.Collapsed);
        this.tooltip = new MarkdownString(`$(globe) ${data.uuid}
___
$(book) ${data.description}
___
$(clock) ${data.lastUpdated}
`, true
        );
        this.iconPath = new ThemeIcon("archive");
        this.contextValue = this.data.hasDownloadableContent ? 'archiveWithFiles' : "archive";
    }
}

class DescriptionNode extends TreeItem {

    constructor(descr: string) {
        super(descr, TreeItemCollapsibleState.None);
        this.iconPath = new ThemeIcon("book");
    }
}

class FilesNode extends TreeItem {

    constructor(
        label: string,
        public readonly files: FilesContainer
    ) {
        super(label, TreeItemCollapsibleState.Collapsed);
        this.contextValue = "files";
        this.iconPath = new ThemeIcon("files");
    }
}

class FileNode extends TreeItem {

    constructor(public readonly file: File) {
        super(file.name, TreeItemCollapsibleState.None);
        this.contextValue = "file";
        this.iconPath = new ThemeIcon("file-text");
        this.tooltip = new MarkdownString(`$(globe) ${file.uuid}
___
$(book) ${file.content}`, true);
    }
}

class MoreNode extends TreeItem {

    readonly page: number;

    constructor(cmd: string, page: number = 0) {
        super("...", TreeItemCollapsibleState.None);
        this.page = page;
        this.contextValue = "more";
        this.tooltip = "Load the next set of items";
        this.command = {
            title: "Next page",
            command: cmd,
            tooltip: "Load the next set of items",
            arguments: [page]
        };
    }
}

// ////////////////////////////////////////////////////////////////////////////
// General helpers
// ////////////////////////////////////////////////////////////////////////////

type DomainObject = Archive | Description | FilesContainer | File | LoadMore;

// ////////////////////////////////////////////////////////////////////////////
// FAKE API methods
// ////////////////////////////////////////////////////////////////////////////

const MAX_RESULTS_PER_PAGE = 10;
const MAX_SAMPLES = 30;
function createTestData(): Archive[] {
    const resources: Archive[] = [];
    for (let i = 0; i < MAX_SAMPLES; i++) {
        resources.push(new Archive());
    }
    return resources;
}
const DATA = createTestData();

function _filteredData(filter: Filter): Archive[] {
    const data: Archive[] = [];
    for (const item of DATA) {
        if (filter.term && filter.hasFiles) {
            if ((item.title.includes(filter.term)
                || item.description.includes(filter.term))
                && item.hasDownloadableContent) {
                data.push(item);
            }
        } else if (filter.term && !filter.hasFiles) {
            if (item.title.includes(filter.term)
                || item.description.includes(filter.term)) {
                data.push(item);
            }
        } else {
            if (item.hasDownloadableContent) {
                data.push(item);
            }
        }
    }
    return data;
}

function getTestData(filter: Filter | undefined, page: number): Archive[] {
    if (page < 0) {
        page = 0;
    }
    let data: Archive[];
    if (filter) {
        data = _filteredData(filter);
    } else {
        data = DATA;
    }
    const start = page * MAX_RESULTS_PER_PAGE;
    const end = start + MAX_RESULTS_PER_PAGE;
    return data.slice(start, end);
}

function getTotalDataCount(filter: Filter | undefined): number {
    if (filter) {
        return _filteredData(filter).length;
    } else {
        return DATA.length;
    }
}

// ////////////////////////////////////////////////////////////////////////////
// Test class
// ////////////////////////////////////////////////////////////////////////////

export class TestTreeDataProvider implements TreeDataProvider<DomainObject>, Disposable {

    public static readonly VIEW = "extension.myTreeView";
    public static readonly CONTEXT_HAS_FILTER = TestTreeDataProvider.VIEW + ".hasFilter";
    public static readonly NEXT_PAGE_COMMAND = TestTreeDataProvider.VIEW + ".loadNextPage";
    public static readonly RESET_COMMAND = TestTreeDataProvider.VIEW + ".resetFilter";
    public static readonly DELETE_COMMAND = TestTreeDataProvider.VIEW + ".delete";
    public static readonly DOWNLOAD_SINGLE_FILE_COMMAND = TestTreeDataProvider.VIEW + ".downloadFile";
    public static readonly DOWNLOAD_MOST_RECENT_COMMAND = TestTreeDataProvider.VIEW + ".downloadMostRecent";

    private _onDidChangeTreeData: EventEmitter<void | DomainObject | null | undefined> = new EventEmitter<void | DomainObject | null | undefined>();
    onDidChangeTreeData?: Event<void | DomainObject | null | undefined> | undefined = this._onDidChangeTreeData.event;

    private readonly disposables: Disposable[] = [];
    protected items: (Archive | LoadMore)[] = [];
    private filter: Filter | undefined;

    constructor(
        context: ExtensionContext
    ) {
        this.disposables.push(window.registerTreeDataProvider(TestTreeDataProvider.VIEW, this));

        this.disposables.push(commands.registerCommand(TestTreeDataProvider.RESET_COMMAND,
            this.resetFilter.bind(this))); // or () => this.resetFilter()
        this.disposables.push(commands.registerCommand(TestTreeDataProvider.NEXT_PAGE_COMMAND,
            this.nextPage.bind(this))); // or (page: number) => this.nextPage(page)
        this.disposables.push(commands.registerCommand(TestTreeDataProvider.DOWNLOAD_MOST_RECENT_COMMAND,
            this.downloadMostRecent.bind(this)));
        this.disposables.push(commands.registerCommand(TestTreeDataProvider.DOWNLOAD_SINGLE_FILE_COMMAND,
            this.downloadFile));
        this.disposables.push(commands.registerCommand(TestTreeDataProvider.DELETE_COMMAND, 
            this.delete.bind(this)));

        this.disposables.push(new FilterPanel(context, this));

        this.disposables.forEach(d => context.subscriptions.push(d));
    }

    getTreeItem(element: DomainObject): TreeItem | Thenable<TreeItem> {
        if (element instanceof LoadMore) {
            return new MoreNode(TestTreeDataProvider.NEXT_PAGE_COMMAND, element.page);
        } else if (element instanceof Archive) {
            return new ArchiveNode(element);
        } else if (element instanceof Description) {
            return new DescriptionNode(element.description);
        } else if (element instanceof FilesContainer) {
            return new FilesNode("files", element);
        } else if (element instanceof File) {
            return new FileNode(element);
        }
        throw new Error(`Unsupported tree item ${JSON.stringify(element)}`);
    }

    getChildren(element?: DomainObject): ProviderResult<DomainObject[]> {
        if (element) {
            if (element instanceof LoadMore) {
                // LoadMore nodes will never have children
                return [];
            } else if (element instanceof Archive) {
                if (element.files) {
                    return [new Description(element.description), element.files];
                } else {
                    return [new Description(element.description)];
                }
            } else if (element instanceof FilesContainer) {
                return element.files;
            } else {
                return undefined;
            }
        } else if (this.items.length > 0) {
            return this.items;
        } else {
            const items = this.loadData();
            items.forEach(item => this.items.push(item));
            return this.items;
        }
    }

    private loadData(page: number = 0): (Archive | LoadMore)[] {
        const items: (Archive | LoadMore)[] = getTestData(this.filter, page);
        if ((this.items.length + items.length) < getTotalDataCount(this.filter)) {
            items.push(new LoadMore(page + 1));
        }

        return items;
    }

    private nextPage(page: number): void {
        if (this.items.length > 0 && this.items[this.items.length - 1] instanceof LoadMore) {
            // remove the last load-more item from the tree
            this.items.pop();
            const newItems = this.loadData(page);
            this.addItemsToTree(newItems);
        }
        this._onDidChangeTreeData.fire();
    }

    private addItemsToTree(items: (Archive | LoadMore)[]): void {
        items.forEach(item => this.addItemToTree(item));
        this._onDidChangeTreeData.fire();
    }

    private addItemToTree(item: (Archive | LoadMore)): void {
        let idx = 0;
        for (idx; idx < this.items.length; idx++) {
            if (item instanceof LoadMore) {
                // add the LoadMore item to the end of the list and call it
                // done
                this.items.push(item);
                return;
            } else if (item instanceof Archive) {
                // we may have deleted items in the list which are now 'undefined'
                const curItem = this.items[idx] as Archive | undefined;
                if (curItem) {
                    // sort items by their internal ID
                    if (curItem.internalId > item.internalId) {
                        break;
                    }
                    // we don't need to add the same node twice as we already
                    // added that node previously
                    if (curItem.uuid === item.title) {
                        return;
                    }
                }
            }
        }

        this.items.splice(idx, 0, item);
    }

    private async downloadMostRecent(archive: Archive): Promise<void> {
        if (archive.files) {
            const files = archive.files.files;
            const mostRecent: File = files[files.length - 1];

            return this.downloadFile(mostRecent);
        }
        return Promise.resolve();
    }

    private async downloadFile(file: File): Promise<void> {
        return window.showSaveDialog({
            title: "Save file to ..."
        }).then(async (uri: Uri | undefined) => {
            if (uri) {
                await workspace.fs.writeFile(uri, Buffer.from(file.content));
                return uri;
            }
            return undefined;
        }).then(async (uri: Uri | undefined) => {
            if (uri) {
                return workspace.openTextDocument(uri);
            }
            return;
        }).then(async (doc: TextDocument | undefined) => {
            if (doc) {
                await window.showTextDocument(doc, undefined, false);
            }
        });
    }

    public async delete(item: Archive): Promise<void> {
        const choice = await this.promptUserAction(`Do you really want to delete archive ${item.title}?`, 'Yes', 'No');
        if (choice === 'Yes') {
            // Determining index of item to delte
            const idx = this.items.findIndex(_item => 
                _item                                 // item may have been deleted before
                && _item instanceof Archive           // we are only interested in archives
                && _item.uuid === item.uuid);         // and that the UUID matches the one provided as input
            delete this.items[idx];

            // request update of the tree
            this._onDidChangeTreeData.fire();
        }
    }

    private async promptUserAction(msg: string, ...choices: string[]): Promise<string | undefined> {
        if (!choices || choices.length === 0) {
            return undefined;
        }
        return new Promise<string | undefined>((resolve, reject) => {
            void window.showWarningMessage(msg, { modal: true }, ...choices)
                .then((action: string | undefined) => {
                    if (action) {
                        resolve(action);
                    } else {
                        reject(undefined);
                    }
                });
        });
    }

    public async updateFilter(filter: Filter): Promise<void> {
        this.filter = filter;

        await commands.executeCommand("setContext", TestTreeDataProvider.CONTEXT_HAS_FILTER, true);
        this.items = [];
        this._onDidChangeTreeData.fire();
    }

    private async resetFilter(): Promise<void> {
        this.filter = undefined;
        await commands.executeCommand("setContext", TestTreeDataProvider.CONTEXT_HAS_FILTER, false);
        this.items = [];
        this._onDidChangeTreeData.fire();
    }

    public dispose(): void {
        this.disposables.forEach(disposable => {
            disposable.dispose();
        });
    }
}
