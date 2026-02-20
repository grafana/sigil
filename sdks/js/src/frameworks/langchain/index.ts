import type { SigilClient } from '../../client.js';
import { SigilFrameworkHandler, type FrameworkHandlerOptions } from '../shared.js';

export type { FrameworkHandlerOptions };

export class SigilLangChainHandler extends SigilFrameworkHandler {
  name = 'sigil_langchain_handler';

  constructor(client: SigilClient, options: FrameworkHandlerOptions = {}) {
    super(client, 'langchain', 'javascript', options);
  }
}
