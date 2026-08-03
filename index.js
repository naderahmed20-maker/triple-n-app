import { registerRootComponent } from 'expo';

import App from 'expo-router/entry';

import HeadlessBackgroundEntry from './scan/core/HeadlessBackgroundEntry';

import { AppRegistry } from 'react-native';

AppRegistry.registerHeadlessTask(
  'TripleNHeadlessBackground',
  () => HeadlessBackgroundEntry,
);

registerRootComponent(App);