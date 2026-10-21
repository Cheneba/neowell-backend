-- Device tokens are no longer Expo-specific (FCM tokens are stored here too).
ALTER TABLE "Device" RENAME COLUMN "expoPushToken" TO "pushToken";
ALTER INDEX "Device_expoPushToken_key" RENAME TO "Device_pushToken_key";
