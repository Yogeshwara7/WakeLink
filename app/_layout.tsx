import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Colors } from '../src/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" backgroundColor={Colors.bg} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.bg },
          headerTintColor: Colors.textPrimary,
          headerShadowVisible: false,
          headerBackTitle: '',
          contentStyle: { backgroundColor: Colors.bg },
          animation: 'slide_from_right',
        }}
      >
        {/* Onboarding — no header */}
        <Stack.Screen name="index" options={{ headerShown: false }} />

        {/* Main tabs shell */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

        {/* Device detail — pushed modally from home */}
        <Stack.Screen
          name="device/[id]"
          options={{ title: 'Device', headerShown: true }}
        />

        {/* Pair flow */}
        <Stack.Screen
          name="pair/index"
          options={{
            title: 'Pair a PC',
            presentation: 'modal',
            headerShown: true,
          }}
        />

        {/* Connection state machine */}
        <Stack.Screen
          name="connect/[id]"
          options={{
            title: '',
            headerShown: true,
            presentation: 'fullScreenModal',
            gestureEnabled: false,
          }}
        />

        {/* Placeholder remote-session screen */}
        <Stack.Screen
          name="session/[id]"
          options={{
            headerShown: false,
            presentation: 'fullScreenModal',
            gestureEnabled: false,
          }}
        />
      </Stack>
    </>
  );
}
