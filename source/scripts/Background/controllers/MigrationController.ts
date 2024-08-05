import { loadState } from 'utils/localStorage';

const MigrationController = async () => {
  const state: any = await loadState();

  if (!state) {
    return;
  }
};

export default MigrationController;
