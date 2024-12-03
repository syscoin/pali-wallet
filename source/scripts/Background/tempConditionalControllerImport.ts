export const tempGetController = async () => {
  console.log(process.env);
  if (process.env.NEW_BACKGROUND === 'true') {
    console.log('I am groot');
    const { getController } = await import(
      'scripts/Background/NEW_Background-index'
    );
    return getController;
  } else {
    console.log('we are groot');
    const { getController } = await import('scripts/Background');
    return getController;
  }
};
