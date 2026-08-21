import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { Colors, FontSize } from '../../src/theme';

/** Simple SVG-free tab icons using unicode symbols for zero extra deps. */
function TabIcon({ symbol, focused }: { symbol: string; focused: boolean }) {
  return (
    <View style={styles.iconWrap}>
      <View>
        {/* Using text as icon placeholder — replace with vector icons later */}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.bg },
        headerTintColor: Colors.textPrimary,
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: Colors.bgCard,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: Colors.brand,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: {
          fontSize: FontSize.xs,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'My PCs',
          tabBarLabel: 'My PCs',
        }}
      />
      <Tabs.Screen
        name="pair"
        options={{
          title: 'Add PC',
          tabBarLabel: 'Add PC',
          href: null, // accessible via button, not tab bar
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
