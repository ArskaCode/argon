local function getInstance(parent)
    local lastParent = game
    parent = string.split(parent, '.')

    for _, v in ipairs(parent) do
        lastParent = lastParent[v]
    end

    return lastParent
end

local fileHandler = {}

function fileHandler.create(type, name, parent)
    local success, response = pcall(function()
        local object = Instance.new(type)
        object.Name = name
        object.Parent = getInstance(parent)
    end)

    if not success then
        warn('Argon: '..response)
    end
end

function fileHandler.update(object, source)
    local success, response = pcall(function()
        getInstance(object).Source = source
    end)

    if not success then
        warn('Argon: '..response)
    end
end

function fileHandler.delete(object)
    local success, response = pcall(function()
        getInstance(object):Destroy()
    end)

    if not success then
        warn('Argon: '..response)
    end
end

return fileHandler