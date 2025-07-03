// client.ts - Complete remote MCP client instance
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import OpenAI from "openai";
import fs from 'fs';
import readline from 'readline';
import { exit } from 'process';
import { mcpConfig, llmConfigs } from './config.js';

console.log("MCP configuration:", JSON.stringify(mcpConfig, null, 2));

// User address for connecting the wallet.
const connectAddress = "0xF5054F94009B7E9999F6459f40d8EaB1A2ceA22D";
// Whether the simulated trading execution result is successful.
const mockTxStatusSuccess = true;

async function main() {
    try {
        const modelKey = process.argv[2];
        const llmConfig = llmConfigs[modelKey];
        console.log("LLM Configuration:", JSON.stringify(llmConfig, null, 2));

        // Read the system prompts
        const toolPrompt = fs.readFileSync('prompt/tool_prompt.md', 'utf-8');
        const outputPrompt = toolPrompt;
        // const outputPrompt = fs.readFileSync('prompt/output_prompt.md', 'utf-8');

        // mcp server
        let sseTransport;
        switch (mcpConfig.transport) {
            case "sse":
                console.log(`connect mcp server by sse`);
                sseTransport = new SSEClientTransport(new URL(mcpConfig.url));
                break
            case "httpStream":
                console.log(`connect mcp server by httpStream`);
                sseTransport = new StreamableHTTPClientTransport(new URL(mcpConfig.url));
                break
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
        console.log("Tool list:");
        availableTools.forEach(tool => {
            console.log(`Tool Name: ${tool.function.name}`);
            console.log(`Description: ${tool.function.description}`);
            console.log(`Parameter: ${JSON.stringify(tool.function.parameters)}`);
            console.log('-----------------------------');
        });

        // llm
        const openai = new OpenAI(
            {
                apiKey: llmConfig.apiKey,
                baseURL: llmConfig.baseURL,
            }
        );

        let continueConversation = true;
        const messages = [
            { role: "system", content: '' },
            { role: "user", content: `connectAddress is a global variable. This variable represents the user's address and the transaction sending address, and it may also become the transaction to address or other parameters. connectAddress: ${connectAddress}` }
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

            messages[0].content = toolPrompt;
            // console.log(`messages: ${JSON.stringify(messages)}`);
            const completion = await openai.chat.completions.create({
                model: llmConfig.model,
                messages: messages,
                tools: availableTools,
                tool_choice: "auto",
                chat_template_kwargs: { "enable_thinking": llmConfig.enableThinking },
                stream: true,
            });

            let toolCallFunctionName = "";
            let toolCallParams = "";
            let messageType = 0;
            let aiResponse = "";
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
                    // console.log(part.choices[0].delta.tool_calls[0].function.arguments)
                    if (!toolCallFunctionName) {
                        toolCallFunctionName = part.choices[0].delta.tool_calls[0].function.name
                    }
                    // function arg finished
                    if (toolCallFunctionName && part.choices[0].delta.tool_calls[0].function.name && toolCallFunctionName != part.choices[0].delta.tool_calls[0].function.name) {
                        const toolResult = await callTools(mcpClient, toolCallFunctionName, toolCallParams);
                        handleToolResult(messages, toolResult);
                        toolCallFunctionName = part.choices[0].delta.tool_calls[0].function.name
                        toolCallParams = "";
                    }
                    // add arg
                    if (part.choices[0].delta.tool_calls[0].function.arguments && part.choices[0].delta.tool_calls[0].function.arguments != "") {
                        toolCallParams += part.choices[0].delta.tool_calls[0].function.arguments
                    }
                }

                // stop
                if (part.choices[0].finish_reason == "tool_calls") {
                    const toolResult = await callTools(mcpClient, toolCallFunctionName, toolCallParams);
                    handleToolResult(messages, toolResult);
                }
            }

            if (aiResponse !== "") {
                messages.push({ role: "assistant", content: aiResponse });
            }

            // Carry tools to initiate the request.
            if (toolCallFunctionName && toolCallFunctionName != "") {
                messages[0].content = outputPrompt;
                // console.log(`messages: ${JSON.stringify(messages)}`);
                const finallyCompletion = await openai.chat.completions.create({
                    model: llmConfig.model,
                    messages: messages,
                    tools: availableTools,
                    tool_choice: "auto",
                    chat_template_kwargs: { "enable_thinking": llmConfig.enableThinking },
                    stream: true,
                });

                let messageType = 0;
                let finalAiResponse = "";
                process.stdout.write("\n");
                for await (const part of finallyCompletion) {
                    // console.log(`part.choices[0]: ${JSON.stringify(part.choices[0])}`);
                    if (part.choices[0].delta.reasoning_content) {
                        if (messageType != 1) {
                            process.stdout.write("🔧🤔 AI Think(Tools):\n");
                            messageType = 1;
                        }
                        process.stdout.write(part.choices[0].delta.reasoning_content);
                    }
                    if (part.choices[0].delta.content) {
                        if (messageType != 2) {
                            process.stdout.write("🔧✅ AI(Tools):\n");
                            messageType = 2;
                        }
                        process.stdout.write(part.choices[0].delta.content);
                        finalAiResponse += part.choices[0].delta.content;
                    }
                }
                if (finalAiResponse !== "") {
                    messages.push({ role: "assistant", content: finalAiResponse });
                }
                // console.log(`finalAiResponse: ${finalAiResponse}`)
            }
            process.stdout.write("\n");
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

async function callTools(mcpClient, functionName, toolCallParams) {
    console.log(`Call mcp tool. functionName: ${functionName}, params: ${toolCallParams}`);

    const paramsArray = toolCallParams.includes('}{') ? toolCallParams.split('}{').map((param, index, array) => {
        if (index === 0) return param + '}';
        if (index === array.length - 1) return '{' + param;
        return '{' + param + '}';
    }) : [toolCallParams];

    const results = [];
    for (const params of paramsArray) {
        const result = await mcpClient.callTool({
            name: functionName,
            arguments: JSON.parse(params)
        });
        console.log("Tool call result:\n", JSON.stringify(result, null, 2));
        results.push(result);
    }

    return results;
}

function handleToolResult(messages, toolResults) {
    toolResults.forEach(toolResult => {
        if (JSON.parse(toolResult.content[0].text).signNeed == true) {
            if (mockTxStatusSuccess) {
                messages.push({
                    role: "user",
                    content: "tx success. tx hash: 0xd9c51fc233d947de75157a1fec9a516a7e48489427c41b976355b66a2da5fca1",
                });
            } else {
                messages.push({
                    role: "user",
                    content: "tx faild. error: user cancel.",
                });
            }
        } else {
            messages.push({
                role: "user",
                content: JSON.stringify(toolResult),
            });
        }
    });
}

main();