jest.mock('../../../wallet/noteBackupService', () => ({
  createNoteBackupService: jest.fn(),
}));

import { createNoteBackupService } from '../../../wallet/noteBackupService';
import { decodeNoteBackupFile } from 'utils/privacy/noteBackupWire';

import { createExtensionNoteBackupController } from './noteBackup';
import type {
  INoteBackupService,
  INoteBackupServicePorts,
} from '../../../wallet/noteBackupService';

const make = () => {
  const service = {
    begin: jest.fn(() => 'operation'),
    cancel: jest.fn(),
    commitImport: jest.fn(),
    exportEncrypted: jest.fn(),
    prepareImport: jest.fn(),
    readCommitReceipt: jest.fn(),
    verifyExport: jest.fn(),
  };
  jest
    .mocked(createNoteBackupService)
    .mockReturnValue(service as unknown as INoteBackupService);
  return {
    service,
    controller: createExtensionNoteBackupController(
      {} as INoteBackupServicePorts
    ),
  };
};

it('exports only a copied encrypted file and public counts over JSON messaging', async () => {
  const { service, controller } = make();
  const bytes = new Uint8Array([80, 65, 76, 73]);
  service.exportEncrypted.mockResolvedValue({
    id: 'operation',
    bytes,
    noteCount: 2,
    createdAt: 100,
    unexpectedSecret: 'never-transport-this',
  });
  const result = await controller.exportEncrypted(
    'operation',
    'wallet-password',
    'file-password'
  );
  expect(JSON.parse(JSON.stringify(result))).toEqual({
    id: 'operation',
    file: 'UEFMSQ==',
    noteCount: 2,
    createdAt: 100,
  });
  expect(bytes).toEqual(new Uint8Array(4));
  expect(decodeNoteBackupFile(result.file)).toEqual(
    new Uint8Array([80, 65, 76, 73])
  );
});

it.each(['prepareImport', 'verifyExport'] as const)(
  'bounds and clears %s ciphertext at the adapter boundary',
  async (method) => {
    const { service, controller } = make();
    let captured: Uint8Array | undefined;
    service[method].mockImplementation(async (_id, bytes) => {
      captured = bytes;
      expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
      return { id: 'operation' };
    });
    await controller[method]('operation', 'AQID', 'file-password');
    expect(captured).toEqual(new Uint8Array(3));
    await expect(
      controller[method]('operation', 'AR==', 'file-password')
    ).rejects.toThrow('BACKUP_INVALID_FORMAT');
    expect(service[method]).toHaveBeenCalledTimes(1);
  }
);

it('forwards one-use commit and receipt checks without replay or plaintext access', async () => {
  const { service, controller } = make();
  service.commitImport.mockRejectedValue(
    new Error('BACKUP_COMMIT_UNCONFIRMED')
  );
  service.readCommitReceipt.mockResolvedValue(null);
  await expect(
    controller.commitImport('operation', 'wallet-password')
  ).rejects.toThrow('BACKUP_COMMIT_UNCONFIRMED');
  expect(await controller.readCommitReceipt('operation')).toBeNull();
  expect(service.commitImport).toHaveBeenCalledTimes(1);
  expect(Object.keys(controller)).toEqual([
    'begin',
    'cancel',
    'commitImport',
    'exportEncrypted',
    'prepareImport',
    'readCommitReceipt',
    'verifyExport',
  ]);
});
