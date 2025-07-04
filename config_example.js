export const mcpConfig = {
    transport: "sse",
    url: "http://36.189.252.2:18133/sse",
    timeout: 30000,
    retryPolicy: {
        maxRetries: 3,
        backoffFactor: 2
    }
};

export const llmConfigs = {
    "qwen3:8b": {
        model: "Qwen/Qwen3-8B",
        apiKey: "sk-xx",
        baseURL: "https://chat-api.orcamind.ai/v1",
        enableThinking: false,
    },
    "openai/gpt-4o-2024-11-20": {
        model: "openai/gpt-4o-2024-11-20",
        apiKey: "sk-xx",
        baseURL: "https://openrouter.ai/api/v1",
        enableThinking: false,
    },
    "google/gemini-2.5-pro": {
        model: "google/gemini-2.5-pro",
        apiKey: "sk-xx",
        baseURL: "https://openrouter.ai/api/v1",
        enableThinking: false,
    },
    "anthropic/claude-opus-4": {
        model: "anthropic/claude-opus-4",
        apiKey: "sk-xx",
        baseURL: "https://openrouter.ai/api/v1",
        enableThinking: false,
    },
    "anthropic/claude-sonnet-4": {
        model: "anthropic/claude-sonnet-4",
        apiKey: "sk-xx",
        baseURL: "https://openrouter.ai/api/v1",
        enableThinking: false,
    },
    "meta-llama/llama-3.1-405b-instruct": {
        model: "meta-llama/llama-3.1-405b-instruct",
        apiKey: "sk-xx",
        baseURL: "https://openrouter.ai/api/v1",
        enableThinking: false,
    },
    "qwen/qwen-max-2025-01-25": {
        model: "qwen/qwen-max-2025-01-25",
        apiKey: "sk-xx",
        baseURL: "https://openrouter.ai/api/v1",
        enableThinking: false,
    }
};

// User address for connecting the wallet.
const connectAddress = "0xF5054F94009B7E9999F6459f40d8EaB1A2ceA22D";
// Whether the simulated trading execution result is successful.
export const mockTxStatusSuccess = true;
// first user message
export const initMsg = `connectAddress is a global variable. This variable represents the user's address and the transaction sending address, and it may also become the transaction to address or other parameters. connectAddress: ${connectAddress}`
// debug log
export const debug = false;