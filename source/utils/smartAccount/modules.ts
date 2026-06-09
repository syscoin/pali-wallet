import type {
  ISmartAccountMetadata,
  SmartAccountExecutorModule,
  SmartAccountValidatorModule,
} from 'types/network';

export const getInstalledValidatorModule = <
  T extends SmartAccountValidatorModule
>(
  metadata: ISmartAccountMetadata,
  id: T['id']
): T | undefined =>
  metadata.installedModules?.find(
    (module): module is T => module.type === 'validator' && module.id === id
  );

export const getInstalledExecutorModule = <
  T extends SmartAccountExecutorModule
>(
  metadata: ISmartAccountMetadata,
  id: T['id']
): T | undefined =>
  metadata.installedModules?.find(
    (module): module is T => module.type === 'executor' && module.id === id
  );
