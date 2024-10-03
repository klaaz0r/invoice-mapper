import { createOpenAI } from "@ai-sdk/openai";
import dotenv from "dotenv";
import { generateObject } from "ai";
import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import * as path from "path";
import pdf from "pdf-parse";
import { z } from "zod";
import { stringify } from "csv-stringify";

dotenv.config();

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function readInvoices(): Promise<
  { content: string; fileName: string; filePath: string }[]
> {
  const invoiceDir = path.join(__dirname, "..", "invoices");
  const files = await fs.readdir(invoiceDir);
  const pdfFiles = files.filter(
    (file) => path.extname(file).toLowerCase() === ".pdf"
  );

  const invoiceData: { content: string; fileName: string; filePath: string }[] =
    [];

  for (const file of pdfFiles) {
    const filePath = path.join(invoiceDir, file);
    const dataBuffer = await fs.readFile(filePath);
    const pdfData = await pdf(dataBuffer);
    invoiceData.push({
      content: pdfData.text,
      fileName: file,
      filePath: filePath,
    });
  }

  return invoiceData;
}

async function extractInvoiceData(invoiceContent: string): Promise<any> {
  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-2024-08-06", {
        structuredOutputs: true,
      }),
      mode: "json",
      maxRetries: 8,
      system: `You are a helpful assistant that extracts detailed information from invoice contents. Focus on quality and extract detailed information to create an accurate representation of the invoice data.`,
      schema: z.object({
        invoiceNumber: z
          .string()
          .describe(
            "The unique identifier for this invoice, avoid special characters like # and * and \\x"
          ),
        issueDate: z.string().describe("The date when the invoice was issued"),
        companyName: z
          .string()
          .describe("The name of the company that issued the invoice"),
        companyAddress: z
          .string()
          .describe("The address of the company that issued the invoice"),
        dueDate: z
          .string()
          .describe("The date by which the invoice should be paid"),
        totalAmount: z.number().describe("The total amount due on the invoice"),
        currency: z.string().describe("The currency used in the invoice"),
        customerName: z
          .string()
          .describe("The name of the customer or company being billed"),
        customerAddress: z
          .string()
          .describe("The billing address of the customer"),
        taxes: z
          .number()
          .describe(
            "The total amount of taxes applied to the invoice, just return 0 if no taxes are applied"
          ),
      }),
      prompt: `Extract the following information from this invoice content: ${invoiceContent}`,
    });

    return object;
  } catch (error) {
    console.error("Error extracting invoice data:", error);
    throw error;
  }
}

async function writeToCSV(data: any[], outputPath: string) {
  const stringifier = stringify({
    header: false,
    columns: [
      "fileName",
      "invoiceNumber",
      "issueDate",
      "companyName",
      "companyAddress",
      "dueDate",
      "totalAmount",
      "currency",
      "customerName",
      "customerAddress",
      "taxes",
    ],
  });
  const writeStream = createWriteStream(outputPath);

  for (const row of data) {
    const csvRow = {
      ...row,
      fileName: row.fileName || "", // Add fileName to each row
    };
    stringifier.write(csvRow);
  }

  stringifier.pipe(writeStream);

  return new Promise((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
    stringifier.end();
  });
}

async function main() {
  try {
    const invoiceContents = await readInvoices();
    console.log(`Parsed ${invoiceContents.length} invoices.`);

    const extractedData = [];

    for (const invoice of invoiceContents) {
      console.log("Processing invoice:", invoice.fileName);
      try {
        const data = await extractInvoiceData(invoice.content);
        extractedData.push({
          ...data,
          fileName: invoice.fileName,
        });
        console.log("Extracted invoice data:", JSON.stringify(data, null, 2));
      } catch (error) {
        console.error("Error extracting invoice data:", error);
      }
    }

    const outputPath = path.join(__dirname, "..", "invoice_data.csv");
    await writeToCSV(extractedData, outputPath);
    console.log(`CSV file written to ${outputPath}`);
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
