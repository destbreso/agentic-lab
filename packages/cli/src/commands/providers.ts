// ============================================
// CLI: providers command — List and test providers
// ============================================

import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, createProvider, getAvailableProviders } from '@agentic-lab/core';

interface ProvidersOptions {
  test?: boolean;
}

export async function providersCommand(options: ProvidersOptions): Promise<void> {
  console.log(chalk.cyan('\n🤖 Agentic Lab — LLM Providers\n'));

  const appConfig = await loadConfig();

  // Show available providers
  const allProviders = getAvailableProviders();
  console.log(chalk.white('  Available providers:\n'));

  for (const name of allProviders) {
    const configured = !!appConfig.providers[name];
    const config = appConfig.providers[name];

    const icon = configured ? chalk.green('✅') : chalk.gray('○');
    const model = config?.defaultModel || chalk.gray('(not configured)');
    console.log(`    ${icon} ${chalk.bold(name.padEnd(12))} ${model}`);

    if (configured && config?.baseUrl) {
      console.log(chalk.gray(`       URL: ${config.baseUrl}`));
    }
  }

  // Test connectivity if requested
  if (options.test) {
    console.log(chalk.white('\n  Testing connectivity:\n'));

    for (const name of allProviders) {
      const config = appConfig.providers[name];
      if (!config) continue;

      const spinner = ora(`  Testing ${name}...`).start();

      try {
        const provider = createProvider(name, {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.defaultModel || 'default',
        });

        const healthy = await provider.healthCheck();
        if (healthy) {
          spinner.succeed(`  ${name} — connected`);

          // Try to list models
          try {
            const models = await provider.listModels();
            if (models.length > 0) {
              const display = models.slice(0, 5).join(', ');
              const more = models.length > 5 ? ` (+${models.length - 5} more)` : '';
              console.log(chalk.gray(`       Models: ${display}${more}`));
            }
          } catch {
            // Model listing not supported
          }
        } else {
          spinner.fail(`  ${name} — unreachable`);
        }
      } catch (error) {
        spinner.fail(`  ${name} — error: ${(error as Error).message}`);
      }
    }
  }

  console.log('');
}
