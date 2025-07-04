// client.ts - Complete remote MCP client instance
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import OpenAI from "openai";
import fs from 'fs';
import readline from 'readline';
import { exit } from 'process';
import { mcpConfig, llmConfigs, initMsg, mockTxStatusSuccess, debug } from './config.js';

console.log("[System] MCP configuration:", JSON.stringify(mcpConfig, null, 2));
console.log("[System] initMsg:", initMsg);
console.log("[System] mockTxStatusSuccess:", mockTxStatusSuccess);

async function main() {
    try {
        const modelKey = process.argv[2];
        const llmConfig = llmConfigs[modelKey];
        console.log("[System] LLM Configuration:", JSON.stringify(llmConfig, null, 2));

        // Read the system prompts
        const prompt = fs.readFileSync('prompt/prompt.md', 'utf-8');

        // MCP server
        let sseTransport;
        switch (mcpConfig.transport) {
            case "sse":
                console.log(`[System] Connect MCP server by SSE`);
                sseTransport = new SSEClientTransport(new URL(mcpConfig.url));
                break;
            case "httpStream":
                console.log(`[System] Connect MCP server by HTTP Stream`);
                sseTransport = new StreamableHTTPClientTransport(new URL(mcpConfig.url));
                break;
        }
        const mcpClient = new Client({
            name: 'js-mcp-demo',
            version: '1.0.0'
        });
        await mcpClient.connect(sseTransport);
        const tools = (await mcpClient.listTools()).tools;
        const availableTools = tools.map((tool) => ({
            type: "function",
            function: {
                name: `${tool.name}`,
                description: `${tool.description}`,
                parameters: tool.inputSchema
            }
        }));

        // Show tool list in a more readable format
        console.log("[System] Tool list:");
        availableTools.forEach(tool => {
            console.log(`[System] Tool Name: ${tool.function.name}`);
            console.log(`[System] Description: ${tool.function.description}`);
            console.log(`[System] Parameter: ${JSON.stringify(tool.function.parameters)}`);
            console.log('[System] -----------------------------');
        });

        // LLM
        const openai = new OpenAI(
            {
                apiKey: llmConfig.apiKey,
                baseURL: llmConfig.baseURL,
            }
        );

        let continueConversation = true;
        const messages = [
            { role: "system", content: prompt },
            { role: "user", content: initMsg }
        ];

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

        while (continueConversation) {
            const userInput = await new Promise((resolve) => {
                rl.question("\nPlease enter your question (type 'exit' to end the conversation): ", resolve);
            });

            if (userInput.toLowerCase() === 'exit') {
                continueConversation = false;
                rl.close();
                exit();
            } else {
                messages.push({ role: "user", content: userInput });
            }

            let toolCount = 0;
            let toolCallFunctionName = "";
            let aiResponse = "";
            let doStop = false;

            do {
                let toolCalls = new Map();
                if (debug) {
                    console.log(`[System] call llm with messages: ${JSON.stringify(messages)}`);
                    console.log(`[System] curl command: curl --location --request POST "${llmConfig.baseURL}/chat/completions" --header "Authorization: Bearer ${llmConfig.apiKey}" --data-raw '${JSON.stringify({
                        model: llmConfig.model,
                        messages: messages,
                        tools: availableTools,
                        tool_choice: "auto",
                        chat_template_kwargs: { "enable_thinking": llmConfig.enableThinking },
                        stream: true,
                    }).replace(/'/g, "\\'")}'`);
                }
                const completion = await openai.chat.completions.create({
                    model: llmConfig.model,
                    messages: messages,
                    tools: availableTools,
                    tool_choice: "auto",
                    chat_template_kwargs: { "enable_thinking": llmConfig.enableThinking },
                    stream: true,
                });

                let messageType = 0;
                aiResponse = "";
                process.stdout.write("\n");

                for await (const part of completion) {
                    if (part.choices[0].delta.reasoning_content && part.choices[0].delta.reasoning_content != "") {
                        if (messageType != 1) {
                            process.stdout.write("🤔 AI Think:\n");
                            messageType = 1;
                        }
                        process.stdout.write(part.choices[0].delta.reasoning_content);
                    }
                    if (part.choices[0].delta.content && part.choices[0].delta.content != "") {
                        if (messageType != 2) {
                            process.stdout.write("✅ AI:\n");
                            messageType = 2;
                        }
                        process.stdout.write(part.choices[0].delta.content);
                        aiResponse += part.choices[0].delta.content;
                    }

                    if (part.choices[0].delta.tool_calls) {
                        // next function
                        if (part.choices[0].delta.tool_calls[0].function.name && part.choices[0].delta.tool_calls[0].function.name != "") {
                            toolCallFunctionName = part.choices[0].delta.tool_calls[0].function.name;
                            toolCalls.set(toolCallFunctionName, '');
                        }
                        if (part.choices[0].delta.tool_calls[0].function.arguments && part.choices[0].delta.tool_calls[0].function.arguments != "") {
                            toolCalls.set(toolCallFunctionName, toolCalls.get(toolCallFunctionName) + part.choices[0].delta.tool_calls[0].function.arguments);
                        }
                    }

                    if (part.choices[0].finish_reason == "tool_calls") {
                        console.log("\n");
                        for (const [key, value] of toolCalls.entries()) {
                            try {
                                const toolResult = await callTools(++toolCount, mcpClient, key, value);
                                handleToolResult(messages, toolResult);
                            } catch (error) {
                                console.error("[System] Error in tool call:", error);
                            }
                        }
                    }
                    if (!doStop) {
                        doStop = part.choices[0].finish_reason != null && part.choices[0].finish_reason == "stop";
                    }
                }

                if (aiResponse !== "") {
                    messages.push({ role: "assistant", content: aiResponse });
                }

            } while (!doStop);

            process.stdout.write("\n");
        }
    } catch (error) {
        console.error("[System] Error:", error);
    }
}

async function callTools(count, mcpClient, functionName, toolCallParams) {
    console.log(`[System] Call MCP tool. Current call tool count: ${count}, functionName: ${functionName}, params: ${toolCallParams}`);

    const results = [];
    const result = await mcpClient.callTool({
        name: functionName,
        arguments: JSON.parse(toolCallParams)
    });
    console.log("[System] Tool call result:", JSON.stringify(result));
    results.push(result);

    return results;
}

function handleToolResult(messages, toolResults) {
    toolResults.forEach(toolResult => {
        messages.push({
            role: "user",
            content: JSON.stringify(toolResult),
        });
        if (JSON.parse(toolResult.content[0].text).signNeed == true) {
            if (mockTxStatusSuccess) {
                messages.push({
                    role: "user",
                    content: "tx success. tx hash: 0xd9c51fc233d947de75157a1fec9a516a7e48489427c41b976355b66a2da5fca1",
                });
            } else {
                messages.push({
                    role: "user",
                    content: "tx failed. error: user cancel.",
                });
            }
        }
    });
}

main();