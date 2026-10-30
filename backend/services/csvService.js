const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

// Read all records from CSV
function readCSV(filePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            return resolve([]);
        }

        const results = [];

        fs.createReadStream(filePath, { encoding: "utf8" })
            .pipe(
                csv({
                    mapHeaders: ({ header }) =>
                        header.replace(/^\uFEFF/, "").trim()
                })
            )
            .on("data", (data) => {
                // Clean keys and values
                const cleanData = {};
                for (const key in data) {
                    if (Object.prototype.hasOwnProperty.call(data, key)) {
                        cleanData[key.trim()] = (data[key] !== undefined && data[key] !== null) ? String(data[key]).trim() : "";
                    }
                }
                results.push(cleanData);
            })
            .on("end", () => {
                resolve(results);
            })
            .on("error", (error) => {
                reject(error);
            });
    });
}

// Append one record to CSV
async function appendCSV(filePath, header, record) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: header,
        append: fs.existsSync(filePath)
    });

    await csvWriter.writeRecords([record]);
}

// Rewrite entire CSV file
async function writeCSV(filePath, header, records) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: header,
        append: false
    });

    await csvWriter.writeRecords(records);
}

module.exports = {
    readCSV,
    appendCSV,
    writeCSV
};