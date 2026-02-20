import type { SigilClient } from '../../client.js';
import { SigilFrameworkHandler, type FrameworkHandlerOptions } from '../shared.js';

export type { FrameworkHandlerOptions };

export class SigilLangGraphHandler extends SigilFrameworkHandler {
  name = 'sigil_langgraph_handler';

  constructor(client: SigilClient, options: FrameworkHandlerOptions = {}) {
    super(client, 'langgraph', 'javascript', options);
  }
}
