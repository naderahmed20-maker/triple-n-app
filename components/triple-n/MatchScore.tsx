import {
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  useTranslation,
} from '@/lib/i18n';

type Props = {
  score: number;
};

export default function MatchScore({
  score,
}: Props) {
  const { t } =
    useTranslation();

  let label = '';

  let color = '';

  if (score >= 90) {
    label = t(
      'matchScore.excellent'
    );

    color = '#22c55e';
  } else if (
    score >= 75
  ) {
    label = t(
      'matchScore.good'
    );

    color = '#3b82f6';
  } else if (
    score >= 50
  ) {
    label = t(
      'matchScore.average'
    );

    color = '#eab308';
  } else {
    label = t(
      'matchScore.poor'
    );

    color = '#ef4444';
  }

  return (
    <View
      style={[
        styles.container,
        {
          borderColor:
            color,
        },
      ]}
    >
      <Text
        style={[
          styles.score,
          {
            color,
          },
        ]}
      >
        {score}%
      </Text>

      <Text
        style={[
          styles.label,
          {
            color,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,

      height: 78,

      borderRadius: 18,

      borderWidth: 2,

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    score: {
      fontSize: 28,

      fontWeight:
        '900',
    },

    label: {
      fontSize: 12,

      fontWeight:
        '800',

      marginTop: 2,
    },
  });