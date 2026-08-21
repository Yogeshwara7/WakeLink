import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../src/theme';

const { width, height } = Dimensions.get('window');

const STEPS = [
  {
    headline: 'Your PC,\nanywhere.',
    body: 'Access your Windows computer from your phone — even when it\'s sleeping.',
    accent: Colors.brand,
  },
  {
    headline: 'Pair once,\nconnect always.',
    body: 'Install the WakeLink Agent on your PC, scan a code, and you\'re done. No IP addresses. No router config.',
    accent: Colors.online,
  },
  {
    headline: 'Wake it up\nremotely.',
    body: 'PC powered off? No problem. WakeLink sends a wake signal before connecting.',
    accent: Colors.waking,
  },
];

export default function OnboardingScreen() {
  const [step, setStep] = React.useState(0);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  // Entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 60,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  function animateToStep(nextStep: number) {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -20,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setStep(nextStep);
      slideAnim.setValue(20);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }

  function handleContinue() {
    if (!isLast) {
      animateToStep(step + 1);
    } else {
      router.replace('/(tabs)');
    }
  }

  function handleSkip() {
    router.replace('/(tabs)');
  }

  return (
    <View style={styles.container}>
      {/* Background gradient substitute — layered views */}
      <View style={[styles.bgGlow, { backgroundColor: current.accent + '18' }]} />

      {/* Logo */}
      <Animated.View
        style={[
          styles.logoWrap,
          { opacity: logoOpacity, transform: [{ scale: logoScale }] },
        ]}
      >
        <View style={[styles.logoMark, { borderColor: current.accent }]}>
          <Text style={[styles.logoIcon, { color: current.accent }]}>⚡</Text>
        </View>
        <Text style={styles.logoText}>WakeLink</Text>
      </Animated.View>

      {/* Content area */}
      <View style={styles.contentWrap}>
        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          }}
        >
          <Text style={[styles.headline, { color: Colors.textPrimary }]}>
            {current.headline}
          </Text>
          <Text style={styles.body}>{current.body}</Text>
        </Animated.View>
      </View>

      {/* Step indicators */}
      <View style={styles.dots}>
        {STEPS.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i === step
                ? { backgroundColor: current.accent, width: 20 }
                : { backgroundColor: Colors.border },
            ]}
          />
        ))}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          onPress={handleContinue}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'Get started' : 'Next'}
          style={[styles.ctaButton, { backgroundColor: current.accent }]}
        >
          <Text style={styles.ctaText}>{isLast ? 'Get Started' : 'Continue'}</Text>
        </TouchableOpacity>

        {!isLast && (
          <TouchableOpacity
            onPress={handleSkip}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
            style={styles.skipButton}
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: Platform.OS === 'ios' ? 48 : 32,
    paddingHorizontal: Spacing.xl,
  },
  bgGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: height * 0.5,
    borderBottomLeftRadius: width,
    borderBottomRightRadius: width,
  },
  logoWrap: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgCard,
  },
  logoIcon: {
    fontSize: 36,
  },
  logoText: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  contentWrap: {
    flex: 1,
    justifyContent: 'center',
    alignSelf: 'stretch',
    paddingVertical: Spacing.xl,
  },
  headline: {
    fontSize: FontSize.xxxl,
    fontWeight: FontWeight.bold,
    lineHeight: FontSize.xxxl * 1.2,
    marginBottom: Spacing.md,
    color: Colors.textPrimary,
  },
  body: {
    fontSize: FontSize.lg,
    color: Colors.textSecondary,
    lineHeight: FontSize.lg * 1.55,
  },
  dots: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  dot: {
    height: 4,
    width: 8,
    borderRadius: Radius.full,
  },
  actions: {
    alignSelf: 'stretch',
    gap: Spacing.sm,
  },
  ctaButton: {
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  ctaText: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
  skipButton: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  skipText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
});
