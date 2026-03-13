import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { CollectionFormModal } from '../../components/saved-conversations/CollectionFormModal';

const meta: Meta<typeof CollectionFormModal> = {
  title: 'SavedConversations/CollectionFormModal',
  component: CollectionFormModal,
};
export default meta;
type Story = StoryObj<typeof CollectionFormModal>;

export const Default: Story = {
  args: {
    isOpen: true,
    onSubmit: async (values) => { console.log('submit', values); },
    onClose: () => {},
  },
};

export const Submitting: Story = {
  args: {
    isOpen: true,
    onSubmit: () => new Promise(() => {}),
    onClose: () => {},
  },
};
