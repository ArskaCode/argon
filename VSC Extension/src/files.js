const fs = require('fs')
const path = require('path')
const vscode = require('vscode')
const events = require('./events')
const config = require('./config/settings')
const project = require('./config/project')
const messageHandler = require('./messageHandler')

let watchers = []
let filesToSync = []
let customPaths = {}
let useCustomPaths = false
let lastUnix = Date.now()

function verify(parent) {
    if (!parent || parent == 'StarterPlayer') {
        return true
    }
}

function isSourceFile(name) {
    if (name == config.source || name == config.source + '.server' || name == config.source + '.client') {
        return true
    }
}

function getParent(root, name) {
    let dir = root.split('\\')
    let occurrenceCount = 0
    let parent = ''

    for (let i = dir.length - 1; i >= 0; i--) {
        if (i != dir.length - 1) {
            parent = dir[i] + config.separator + parent
        }
        else {
            parent = dir[i]
        }

        if (dir[i] == vscode.workspace.name) {
            let occurrences = root.split(dir[i]).length - 1 - occurrenceCount

            if (occurrences == 1) {
                break
            }
            else {
                occurrenceCount = occurrences - 1
            }
        }
    }

    parent = parent.replace(vscode.workspace.name + '|', '')

    if (useCustomPaths) {
        let key = parent + '|' + name

        if (customPaths[key]) {
            parent = customPaths[key].slice(0, -(name.length + 1))
        }
        else {
            for (let [path, target] of Object.entries(customPaths)) {
                if (parent.startsWith(path)) {
                    parent = parent.replace(path, target)
                    break
                }
            }
        }
    }

    if (parent.startsWith(config.rootFolder + '|')) {
        parent = parent.replace(config.rootFolder + '|', '')
    }
    else {
        parent = null
    }

    return parent
}

function getRootDir() {
    let rootDir = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, config.rootFolder)
    let jsonDir = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, config.projectFile + '.project.json')

    if (!fs.existsSync(rootDir)) {
        if (config.autoSetup) {
            fs.mkdirSync(rootDir)
        }
        else {
            messageHandler.showMessage('noRootFolder', 2)
        }
    }

    if (!fs.existsSync(jsonDir) && config.autoSetup) {
        let json = JSON.stringify(project, null, '\t')

        if (config.rootFolder != 'src') {
            json = json.replaceAll('src', config.rootFolder)
        }

        fs.writeFileSync(jsonDir, json)
    }

    return rootDir
}

function loadPaths(tree, root) {
    for (let [key, value] of Object.entries(tree)) {
        if (key == '$path') {
            let path = value.replaceAll('/', '|')

            if (path && path != root) {
                customPaths[path] = root
                useCustomPaths = true

                if (path.split('|').length == 1) {
                    customPaths[vscode.workspace.name + '|' + path] = root
                }
            }
        }
        else {
            loadPaths(value, root + '|' + key)
        }
    }
}

function onCreate(uri) {
    let files = uri.files

    for (uri of files) {
        uri = path.parse(uri.fsPath)
        let parent = getParent(uri.dir, uri.name)

        if (verify(parent) || uri.ext == '.json') {
            return
        }

        if (isSourceFile(uri.name) && !parent.includes(config.separator)) {
            return
        }
    
        events.create(uri.ext, uri.name, parent)
    }
}

function onSave(uri) {
    let source = uri.getText()
    uri = path.parse(uri.fileName)
    let parent = getParent(uri.dir, uri.name)

    if (uri.ext != '.json') {
        if (verify(parent)) {
            return
        }

        if (isSourceFile(uri.name)) {
            if (parent.includes(config.separator)) {
                events.update(parent, source)
            }
        }
        else {
            events.update(parent + config.separator + uri.name, source)
        }
    }
    else if (uri.ext == '.json') {
        if (uri.name == config.properties) {
            if (!parent || parent == '') {
                return
            }

            events.setProperties(parent, source)
        }
        else if (uri.name == config.projectFile + '.project') {
            let project = JSON.parse(source)

            if (project.tree) {
                customPaths = {}
                useCustomPaths = false
                loadPaths(project.tree, config.rootFolder)
            }
        }
    }
}

function onDelete(uri) {
    let files = uri.files

    for (uri of files) {
        uri = path.parse(uri.fsPath)
        let parent = getParent(uri.dir, uri.name)
    
        if (verify(parent) || uri.ext == '.json') {
            return
        }
    
        if (isSourceFile(uri.name)) {
            if (parent.includes(config.separator)) {
                events.remove(parent)
                fs.rmSync(uri.dir, {recursive: true})
            }
        }
        else {
            if (uri.ext == '.lua' || uri.ext == '.luau') {
                events.remove(parent + config.separator + uri.name)
            }
            else {
                events.remove(parent + config.separator + uri.name + uri.ext)
            }
        }
    }
}

function onRename(uri) {
    let files = uri.files

    for (uri of files) {
        let isDirectory = fs.statSync(uri.newUri.fsPath).isDirectory()
        let newUri = path.parse(uri.newUri.fsPath)
        let oldUri = path.parse(uri.oldUri.fsPath)
        let newParent = getParent(newUri.dir, newUri.name)
        let oldParent = getParent(oldUri.dir, oldUri.name)
        
        if (verify(newParent) || verify(oldParent) || newUri.ext == '.json' || oldUri.ext == '.json') {
            return
        }

        if ((isSourceFile(newUri.name) || isSourceFile(oldUri.name)) && !(newParent.includes(config.separator) || !oldParent.includes(config.separator))) {
            return
        }
    
        if (newUri.name != oldUri.name) {
            if (newUri.ext == '.lua' || newUri.ext == '.luau') {
                let newSplitted = newUri.name.split('.')
                let oldSplitted = oldUri.name.split('.')
                
                if (newSplitted.length != oldSplitted.length) {
                    events.changeType(oldParent + config.separator + oldUri.name, newSplitted[newSplitted.length - 1], newUri.name)
                }
                else {
                    let newName = newSplitted[0]
                    let newType = newSplitted[newSplitted.length - 1]
                    let oldName = oldSplitted[0]
                    let oldType = oldSplitted[newSplitted.length - 1]
                    
                    if (newName != oldName && newType == oldType) {
                        events.rename(oldParent + config.separator + oldUri.name, newUri.name)
                    }
                    else if (newType != oldType && newName == oldName) {
                        events.changeType(newParent + config.separator + newUri.name, newType)
                    }
                    else {
                        events.changeType(oldParent + config.separator + oldUri.name, newSplitted[newSplitted.length - 1], newUri.name)
                    }
                }
            }
            else {
                events.rename(oldParent + config.separator + oldUri.name + oldUri.ext, newUri.name + newUri.ext)
            }
        }
        else if (newUri.ext != oldUri.ext) {
            if (isDirectory) {
                events.rename(oldParent + config.separator + oldUri.name + oldUri.ext, newUri.name + newUri.ext)
            }
        }
        else {
            if (isSourceFile(newUri.name)) {
                if (!isDirectory) {
                    setTimeout(() => {
                        fs.renameSync(uri.newUri.fsPath, uri.oldUri.fsPath)
                    }, 100)
                }
            }
            else {
                if (!isDirectory) {
                    events.changeParent(oldParent + config.separator + oldUri.name, newParent)
                }
                else {
                    events.changeParent(oldParent + config.separator + oldUri.name + oldUri.ext, newParent)
                }
            }
        }
    }
}

function run() {
    getRootDir()

    let project = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, config.projectFile + '.project.json')
    if (fs.existsSync(project)) {
        let json = JSON.parse(fs.readFileSync(project).toString())

        if (json.tree) {
            customPaths = {}
            useCustomPaths = false
            loadPaths(json.tree, config.rootFolder)
        }
    }

    watchers.push(vscode.workspace.onDidCreateFiles(onCreate))
    watchers.push(vscode.workspace.onDidSaveTextDocument(onSave))
    watchers.push(vscode.workspace.onDidDeleteFiles(onDelete))
    watchers.push(vscode.workspace.onDidRenameFiles(onRename))
}

function stop() {
    for (let watcher of watchers) {
        watcher.dispose()
    }

    watchers.length = 0
}

function createInstances(dir, instances) {
    for (let [key, value] of instances) {
        let folder = path.join(dir, key)
        value = new Map(Object.entries(value))

        if (key == 'forceSubScript') {
            continue
        }

        if (key.endsWith('.Script')) {
            folder = folder.slice(0, -7)

            if (value.size == 0) {
                fs.writeFileSync(folder + '.server' + config.extension, '')
            }
            else {
                if (!fs.existsSync(folder)) {
                    fs.mkdirSync(folder)
                }

                fs.writeFileSync(path.join(folder, config.source + '.server' + config.extension), '')
            }
        }
        else if (key.endsWith('.LocalScript')) {
            folder = folder.slice(0, -12)

            if (value.size == 0) {
                fs.writeFileSync(folder + '.client' + config.extension, '')
            }
            else {
                if (!fs.existsSync(folder)) {
                    fs.mkdirSync(folder)
                }

                fs.writeFileSync(path.join(folder, config.source + '.client' + config.extension), '')
            }
        }
        else if (key.endsWith('.ModuleScript')) {
            folder = folder.slice(0, -13)

            if (value.size == 0) {
                fs.writeFileSync(folder + config.extension, '')
            }
            else {
                if (!fs.existsSync(folder)) {
                    fs.mkdirSync(folder)
                }

                fs.writeFileSync(path.join(folder, config.source + config.extension), '')
            }
        }
        else {
            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder)
            }
        }

        if (value.size > 0) {
            setTimeout(() => {
                createInstances(folder, value)
            }, 100)
        }
    }

    lastUnix = Date.now()
}

function portInstances(data) {
    data = JSON.parse(data)

    let dir = getRootDir()
    let instances = data.instances
    let mode = data.mode

    if (mode) {
        instances = new Map(Object.entries(instances))
        for (let [key, value] of instances) {
            let folder = path.join(dir, key)

            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder)
            }

            for (let instance of value) {
                instance = new Map(Object.entries(instance))
                createInstances(folder, instance)
            }
        }
    }
    else {
        instances = new Map(Object.entries(instances))
        createInstances(dir, instances)
    }
}

function portScripts(scripts) {
    scripts = JSON.parse(scripts)

    for (let script of scripts) {
        let dir = path.join(getRootDir(), script.Instance)

        if (fs.existsSync(dir + config.extension)) {
            fs.writeFileSync(dir + config.extension, script.Source)
        }
        else {
            switch (script.Type) {
                case 'Script':
                    var localDir = path.join(dir, config.source + '.server') + config.extension
                    if (fs.existsSync(localDir)) {
                        fs.writeFileSync(localDir, script.Source)
                    }
                    break
                case 'LocalScript':
                    var localDir = path.join(dir, config.source + '.client') + config.extension
                    if (fs.existsSync(localDir)) {
                        fs.writeFileSync(localDir, script.Source)
                    }
                    break
                case 'ModuleScript':
                    var localDir = path.join(dir, config.source) + config.extension
                    if (fs.existsSync(localDir)) {
                        fs.writeFileSync(localDir, script.Source)
                    }
                    break
            }
        }
    }

    lastUnix = Date.now()
}

function portProperties(properties) {
    properties = new Map(Object.entries(JSON.parse(properties)))
    let rootDir = getRootDir()

    for (let [key, value] of properties) {
        key = path.join(rootDir, key)
        if (fs.existsSync(key)) {
            value = JSON.stringify(value, null, '\t').replace(/,\n\t\t/g, ', ').replace(/\[\n\t\t/g, '[').replace(/\n\t\]/g, ']').replace(/, \t/g, ', ').replace(/\[\t/g, '[').replace(/\n\t\t\]\]/g, ']]').replace(/\n\t\t\]/g, ']')
            fs.writeFileSync(path.join(key, config.properties + '.json'), value)
        }
    }
}

function portCreate(uri) {
    uri = path.parse(uri)
    let parent = getParent(uri.dir, uri.name)

    if (verify(parent)) {
        return
    }

    if (isSourceFile(uri.name) && !parent.includes(config.separator)) {
        return
    }

    events.create(uri.ext, uri.name, parent)
}

function portSave(uri) {
    let parsedUri = path.parse(uri)
    let parent = getParent(parsedUri.dir, parsedUri.name)

    if (verify(parent)) {
        return
    }

    let source = fs.readFileSync(uri, 'utf-8')

    if (isSourceFile(parsedUri.name)) {
        if (parent.includes(config.separator)) {
            filesToSync.push(events.portSource(parent, source))
        }
    }
    else {
        filesToSync.push(events.portSource(parent + config.separator + parsedUri.name, source))
    }
}

function portUpdate(uri) {
    let parsedUri = path.parse(uri)
    let parent = getParent(parsedUri.dir, parsedUri.name)

    if (!parent || parent == '') {
        return
    }

    let source = fs.readFileSync(uri, 'utf-8')
    events.setProperties(parent, source)
}

function getSubDirs(uri) {
    fs.readdirSync(uri, {withFileTypes: true}).forEach(file => {
        let subUri = path.join(uri, file.name)

        if (file.name != config.properties + '.json') {
            portCreate(subUri)

            if (file.isDirectory()) {
                getSubDirs(subUri)
            }
            else {
                portSave(subUri)
            }
        }
        else {
            portUpdate(subUri)
        }
    })
}

function getChunk(data, index) {
    let lastChunk = []
    let chunk = []

    for (let i = index; i < data.length; i++) {
        index = i
        chunk.push(data[i])

        if (JSON.stringify(chunk).length / 1000 < 1020) {
            lastChunk.push(data[i])
        }
        else {
            return [lastChunk, index]
        }
    }

    return [lastChunk, index]
}

function portProject() {
    let dir = getRootDir()
    let chunks = []
    let index = 0

    fs.readdirSync(dir, {withFileTypes: true}).forEach(file => {
        let uri = path.join(dir, file.name)

        if (file.isDirectory()) {
            portCreate(uri)
            getSubDirs(uri)
        }
    })

    if (filesToSync.length == 0) {
        return [[]]
    }

    do {
        let chunk
        [chunk, index] = getChunk(filesToSync, index)
        chunks.push(chunk)
    } while (index != filesToSync.length - 1);

    filesToSync.length = 0
    return chunks
}

function getTitle() {
    let project = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, config.projectFile + '.project.json')

    if (fs.existsSync(project)) {
        let json = JSON.parse(fs.readFileSync(project).toString())

        if (json.name && json.name != 'Argon') {
            return json.name
        }
    }

    return ''
}

function getUnix() {
    return lastUnix
}

module.exports = {
    run,
    stop,
    portInstances,
    portScripts,
    portProperties,
    portProject,
    getRootDir,
    getTitle,
    getUnix
}