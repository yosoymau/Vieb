/*
* Vieb - Vim Inspired Electron Browser
* Copyright (C) 2019 Jelmer van Arnhem
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
/* global SETTINGS SUGGEST TABS UTIL */
"use strict"

const fs = require("fs")
const path = require("path")
const readline = require("readline")
const {remote} = require("electron")

const histFile = path.join(remote.app.getPath("appData"), "hist")
let history = []
let groupedHistory = {}

const init = () => {
    if (!fs.existsSync(histFile) || !fs.statSync(histFile).isFile()) {
        return
    }
    const histStream = fs.createReadStream(histFile)
    const rl = readline.createInterface({
        input: histStream
    })
    rl.on("line", line => {
        const hist = parseHistLine(line)
        if (hist) {
            history.push(hist)
        }
    }).on("close", () => {
        groupedHistory = history.reduce((list, hist) => {
            if (!list[hist.url]) {
                list[hist.url] = {title: hist.title, visits: 0}
            }
            list[hist.url].visits += 1
            if (!UTIL.hasProtocol(hist.title)) {
                list[hist.url].title = hist.title
            }
            return list
        }, {})
    })
}

const parseHistLine = line => {
    const parts = line.split("\t")
    if (parts.length < 3) {
        return null
    }
    const date = new Date(parts[0])
    if (!date) {
        return null
    }
    return {
        date: date,
        title: parts[1],
        url: parts.slice(2).join("")
    }
}

const suggestHist = search => {
    //Simplify the search to a list of words, or an ordered list of words,
    //ordered matches take priority over unordered matches only.
    //In turn, exact matches get priority over ordered matches.
    search = search.toLowerCase().trim()
    const simpleSearch = search.split(/\W/g).filter(w => w)
    document.getElementById("suggest-dropdown").textContent = ""
    SUGGEST.clear()
    if (!SETTINGS.get("history.suggest") || !search) {
        return
    }
    if (!fs.existsSync(histFile) || !fs.statSync(histFile).isFile()) {
        return
    }
    const suggestions = Object.keys(groupedHistory).map(url => {
        if (!groupedHistory[url]) {
            return null
        }
        const simpleUrl = url.replace(/\W/g, "").toLowerCase()
        const simpleTitle = groupedHistory[url].title
            .replace(/\W/g, "").toLowerCase()
        let relevance = 1
        if (simpleSearch.every(w => simpleUrl.includes(w))) {
            relevance = 5
        }
        if (relevance > 1 || simpleSearch.every(w => simpleTitle.includes(w))) {
            if (url.toLowerCase().includes(search)) {
                relevance *= 10
            }
            return {
                url: url,
                title: groupedHistory[url].title,
                relevance: relevance * groupedHistory[url].visits
            }
        }
        return null
    }).filter(h => h)
    orderSuggestions(suggestions)
}

const orderSuggestions = suggestions => {
    SUGGEST.clear()
    suggestions.sort((a, b) => {
        return b.visits * b.relevance- a.visits * a.relevance
    }).forEach(SUGGEST.addHist)
}

const addToHist = (title, url) => {
    if (!SETTINGS.get("history.storeNewVisits")) {
        return
    }
    if (UTIL.pathToSpecialPageName(url).name) {
        return
    }
    const date = new Date()
    history.push({
        date: date,
        title: title,
        url: url
    })
    if (!groupedHistory[url]) {
        groupedHistory[url] = {title: title, visits: 0}
    }
    groupedHistory[url].visits += 1
    if (!UTIL.hasProtocol(title)) {
        groupedHistory[url].title = title
    }
    const line = `${date.toISOString()}\t${title.replace(/\t/g, " ")}\t${url}\n`
    fs.appendFileSync(histFile, line)
}

const clearHistory = () => {
    try {
        fs.unlinkSync(histFile)
    } catch (e) {
        //Failed to delete, might not exist
    }
    history = []
    groupedHistory = {}
}

const removeFromHistory = (start, end=null) => {
    if (!end || end < start) {
        end = start
    }
    for (let i = start;i <= end;i++) {
        if (i >= history.length) {
            break
        }
        const url = history[i].url
        if (groupedHistory[url]) {
            groupedHistory[url].visits -= 1
            if (groupedHistory[url].visits === 0) {
                groupedHistory[url] = undefined
            }
        }
    }
    history = history.filter((l, index) => {
        return index < start || index > end
    })
    const historyString = history.map(h => {
        return `${h.date.toISOString()}\t${h.title.replace(/\t/g, " ")
        }\t${h.url}`
    }).join("\n")
    if (history.length === 0) {
        clearHistory()
    } else {
        fs.writeFileSync(histFile, `${historyString}\n`)
    }
}

const handleRequest = (type, start, end) => {
    if (type === "range") {
        removeFromHistory(start, end)
    } else if (type === "all") {
        clearHistory()
    }
    TABS.currentPage().getWebContents().send("history-list", history)
}

module.exports = {
    init,
    addToHist,
    suggestHist,
    clearHistory,
    handleRequest
}