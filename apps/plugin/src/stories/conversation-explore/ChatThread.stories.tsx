import ChatThread from '../../components/conversation-explore/ChatThread';
import { mockGenerations, mockGenerationsWithXml } from './fixtures';

const meta = {
  title: 'Sigil/Conversation Explore/ChatThread',
  component: ChatThread,
};

export default meta;

export const Default = {
  args: { generations: mockGenerations },
};

export const SingleGeneration = {
  args: { generations: [mockGenerations[0]] },
};

export const WithXmlBlocks = {
  args: { generations: mockGenerationsWithXml },
};

export const Empty = {
  args: { generations: [] },
};

export const Screenshot = Default;
