import { CollectionFormModal } from '../../components/saved-conversations/CollectionFormModal';

export default {
  title: 'SavedConversations/CollectionFormModal',
  component: CollectionFormModal,
};

export const Default = {
  args: {
    isOpen: true,
    onSubmit: async (values: { name: string; description?: string }) => {
      console.log('submit', values);
    },
    onClose: () => {},
  },
};

export const Submitting = {
  args: {
    isOpen: true,
    onSubmit: () => new Promise<void>(() => {}),
    onClose: () => {},
  },
};
