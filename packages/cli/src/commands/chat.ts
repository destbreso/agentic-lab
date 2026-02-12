// ============================================
// CLI: chat command — Direct LLM conversation
// ============================================

import * as readline from "readline";
import chalk from "chalk";
import ora from "ora";
import {
  loadConfig,
  createProvider,
  type ChatMessage,
  type LLMProvider,
} from "@agentic-lab/core";

interface ChatOptions {
  provider?: string;
  model?: string;
  system?: string;
  temperature?: string;
  maxTokens?: string;
  oneShot?: string;
}

export async function chatCommand(options: ChatOptions): Promise<void> {
  console.log(chalk.cyan("\n💬 Agentic Lab — Chat\n"));

  const spinner = ora("Loading configuration...").start();
  const appConfig = await loadConfig();
  spinner.succeed("Configuration loaded");

  // Resolve provider
  const providerName =
    options.provider || (appConfig.loop.provider as string) || "ollama";
  const providerConfig = appConfig.providers[providerName] || {};
  const model =
    options.model ||
    providerConfig.defaultModel ||
    appConfig.loop.model ||
    "llama3.1";

  // Create provider
  spinner.start(`Connecting to ${providerName}...`);
  const provider = createProvider(providerName, {
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
    model,
  });

  const healthy = await provider.healthCheck();
  if (!healthy) {
    spinner.fail(`Cannot connect to ${providerName}`);
    console.log(
      chalk.red(
        `\n  ❌ Provider "${providerName}" is not reachable. Check your configuration.\n`,
      ),
    );
    process.exit(1);
  }
  spinner.succeed(`Connected to ${providerName} (${model})`);

  // Build initial messages
  const messages: ChatMessage[] = [];
  if (options.system) {
    messages.push({ role: "system", content: options.system });
  } else {
    messages.push({
      role: "system",
      content:
        "You are a helpful AI assistant. Be concise and direct in your responses.",
    });
  }

  const temperature = options.temperature
    ? parseFloat(options.temperature)
    : undefined;
  const maxTokens = options.maxTokens ? parseInt(options.maxTokens) : undefined;

  // One-shot mode: send a single message and exit
  if (options.oneShot) {
    await sendSingleMessage(
      provider,
      messages,
      options.oneShot,
      temperature,
      maxTokens,
    );
    return;
  }

  // Interactive REPL mode
  console.log(chalk.gray("  Type your message and press Enter."));
  console.log(chalk.gray("  Commands: /clear, /system <msg>, /model, /quit\n"));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question(chalk.green("you › "), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // Handle commands
      if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "/q") {
        console.log(chalk.gray("\n  Goodbye! 👋\n"));
        rl.close();
        return;
      }

      if (trimmed === "/clear") {
        // Keep system message, clear history
        const system = messages.find((m) => m.role === "system");
        messages.length = 0;
        if (system) messages.push(system);
        console.log(chalk.gray("  ✓ Conversation cleared\n"));
        prompt();
        return;
      }

      if (trimmed.startsWith("/system ")) {
        const newSystem = trimmed.slice(8).trim();
        const idx = messages.findIndex((m) => m.role === "system");
        if (idx >= 0) {
          messages[idx].content = newSystem;
        } else {
          messages.unshift({ role: "system", content: newSystem });
        }
        console.log(chalk.gray("  ✓ System prompt updated\n"));
        prompt();
        return;
      }

      if (trimmed === "/model") {
        console.log(chalk.gray(`  Provider: ${providerName}`));
        console.log(chalk.gray(`  Model: ${model}`));
        console.log(chalk.gray(`  Messages: ${messages.length}\n`));
        prompt();
        return;
      }

      // Send message to LLM
      messages.push({ role: "user", content: trimmed });

      const thinking = ora({
        text: chalk.gray("thinking..."),
        spinner: "dots",
      }).start();

      try {
        const result = await provider.chat({
          messages,
          temperature,
          maxTokens,
        });

        thinking.stop();

        // Display response
        console.log(chalk.cyan("  ai › ") + result.message.content);
        console.log(
          chalk.gray(
            `       [${result.usage.totalTokens} tokens | ${result.model}]\n`,
          ),
        );

        // Add response to history
        messages.push(result.message);
      } catch (error) {
        thinking.stop();
        console.log(chalk.red(`  ❌ Error: ${(error as Error).message}\n`));
      }

      prompt();
    });
  };

  prompt();
}

async function sendSingleMessage(
  provider: LLMProvider,
  messages: ChatMessage[],
  userMessage: string,
  temperature?: number,
  maxTokens?: number,
): Promise<void> {
  messages.push({ role: "user", content: userMessage });

  const spinner = ora(chalk.gray("thinking...")).start();

  try {
    const result = await provider.chat({
      messages,
      temperature,
      maxTokens,
    });

    spinner.stop();

    console.log(result.message.content);
    console.log(
      chalk.gray(`\n  [${result.usage.totalTokens} tokens | ${result.model}]`),
    );
  } catch (error) {
    spinner.fail(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}
