--[[
    BloxCraft AI - Roblox Studio Auto Sync Companion Plugin
    =======================================================
    Installazione:
    1. In Roblox Studio, vai su 'Plugins' -> 'Plugin Folder'
    2. Salva questo file come 'BloxCraft_Sync.lua'
    OPPURE:
    Incollalo nella Command Bar di Studio e premi Invio!
]]

local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

print("-------------------------------------------------------------------")
print("[BloxCraft AI] ⚡ Plugin di sincronizzazione diretta ATTIVO!")
print("[BloxCraft AI] In ascolto su http://127.0.0.1:28888/poll")
print("-------------------------------------------------------------------")

local isRunning = true

task.spawn(function()
    while isRunning do
        local success, response = pcall(function()
            return HttpService:GetAsync("http://127.0.0.1:28888/poll")
        end)

        if success and response and #response > 2 then
            local jsonOk, data = pcall(function()
                return HttpService:JSONDecode(response)
            end)

            if jsonOk and data and data.code then
                print("[BloxCraft AI] 📥 Ricevuto nuovo script/modello: " .. tostring(data.title))
                
                -- Esegue il codice Luau nel DataModel del Place
                local fn, compileError = loadstring(data.code)
                if fn then
                    local execOk, execError = pcall(fn)
                    if execOk then
                        print("[BloxCraft AI] ✅ INIETTATO CON SUCCESSO NEL PLACE: " .. tostring(data.title))
                        pcall(function()
                            ChangeHistoryService:SetWaypoint("BloxCraft: " .. tostring(data.title))
                        end)
                    else
                        warn("[BloxCraft AI] ❌ Errore esecuzione: " .. tostring(execError))
                    end
                else
                    warn("[BloxCraft AI] ❌ Errore compilazione Luau: " .. tostring(compileError))
                end
            end
        end

        task.wait(1.0)
    end
end)
