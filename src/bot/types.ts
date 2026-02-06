import type { Conversation, ConversationFlavor } from '@grammyjs/conversations';
import type { Context } from 'grammy';
import type { NautilusConfig } from '../config.js';
import type { DataRepo } from '../git/sync.js';

export type NautilusBotContext = ConversationFlavor<Context>;
export type NautilusConversation = Conversation<NautilusBotContext, NautilusBotContext>;

export interface BotDependencies {
  config: NautilusConfig;
  repo: DataRepo;
}
