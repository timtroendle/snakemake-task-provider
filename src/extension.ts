/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as vscode from 'vscode';

let taskProvider: vscode.Disposable | undefined;

export function activate(_context: vscode.ExtensionContext): void {
    let workspaceRoot = vscode.workspace.rootPath;
    if (!workspaceRoot) {
        return;
    }
    let pattern = path.join(workspaceRoot, 'Snakefile');
    let snakemakePromise: Thenable<vscode.Task[]> | undefined = undefined;
    let fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    fileWatcher.onDidChange(() => snakemakePromise = undefined);
    fileWatcher.onDidCreate(() => snakemakePromise = undefined);
    fileWatcher.onDidDelete(() => snakemakePromise = undefined);
    taskProvider = vscode.tasks.registerTaskProvider('snakemake', {
        provideTasks: () => {
            if (!snakemakePromise) {
                snakemakePromise = getSnakemakeTasks();
            }
            return snakemakePromise;
        },
        resolveTask(_task: vscode.Task): vscode.Task | undefined {
            return undefined;
        }
    });
}

export function deactivate(): void {
    if (taskProvider) {
        taskProvider.dispose();
    }
}

function exists(file: string): Promise<boolean> {
    return new Promise<boolean>((resolve, _reject) => {
        fs.exists(file, (value) => {
            resolve(value);
        });
    });
}

function exec(command: string, options: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        cp.exec(command, options, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stdout, stderr });
            }
            resolve({ stdout, stderr });
        });
    });
}

let _channel: vscode.OutputChannel;
function getOutputChannel(): vscode.OutputChannel {
    if (!_channel) {
        _channel = vscode.window.createOutputChannel('Snakemake Auto Detection');
    }
    return _channel;
}

interface SnakemakeTaskDefinition extends vscode.TaskDefinition {
    /**
     * The task name
     */
    task: string;

    /**
     * The Snakemake file containing the task
     */
    file?: string;
}

const buildNames: string[] = ['build', 'compile', 'watch'];
function isBuildTask(name: string): boolean {
    for (let buildName of buildNames) {
        if (name.indexOf(buildName) !== -1) {
            return true;
        }
    }
    return false;
}

const testNames: string[] = ['test'];
function isTestTask(name: string): boolean {
    for (let testName of testNames) {
        if (name.indexOf(testName) !== -1) {
            return true;
        }
    }
    return false;
}

async function getSnakemakeTasks(): Promise<vscode.Task[]> {
    let workspaceRoot = vscode.workspace.rootPath;
    let emptyTasks: vscode.Task[] = [];
    if (!workspaceRoot) {
        return emptyTasks;
    }
    let snakemakeFile = path.join(workspaceRoot, 'Snakefile');
    if (!await exists(snakemakeFile)) {
        return emptyTasks;
    }

    let commandLine = 'snakemake --list';
    try {
        let { stdout, stderr } = await exec(commandLine, { cwd: workspaceRoot });
        if (stderr && stderr.length > 0) {
            getOutputChannel().appendLine(stderr);
            getOutputChannel().show(true);
        }
        let result: vscode.Task[] = [];
        if (stdout) {
            let lines = stdout.split(/\r{0,1}\n/);
            for (let line of lines) {
                if (line.length === 0) {
                    continue;
                }

                let taskName = line;
                let kind: SnakemakeTaskDefinition = {
                    type: 'snakemake',
                    task: taskName
                };
                let task = new vscode.Task(kind, taskName, 'snakemake', new vscode.ShellExecution(`snakemake ${taskName}`));
                task.group = vscode.TaskGroup.Build;
                result.push(task);
            }
        }
        return result;
    } catch (err) {
        let channel = getOutputChannel();
        if (err.stderr) {
            channel.appendLine(err.stderr);
        }
        if (err.stdout) {
            channel.appendLine(err.stdout);
        }
        channel.appendLine('Auto detecting Snakemake tasts failed.');
        channel.show(true);
        return emptyTasks;
    }
}
