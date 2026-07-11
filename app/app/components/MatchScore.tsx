import { StyleSheet, Text, View } from 'react-native';

type Props = {
  score: number;
};

export default function MatchScore({ score }: Props) {
  let label = '';
  let color = '';

  if (score >= 90) {
    label = 'Excellent Match';
    color = '#22c55e';
  } else if (score >= 75) {
    label = 'Good Match';
    color = '#3b82f6';
  } else if (score >= 50) {
    label = 'Average Match';
    color = '#eab308';
  } else {
    label = 'Poor Match';
    color = '#ef4444';
  }

  return (
    <View style={[styles.container, { borderColor: color }]}>
      <Text style={[styles.score, { color }]}>
        {score}%
      </Text>

      <Text style={[styles.label, { color }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
  flex: 1,
  height: 78,
  borderRadius: 18,
  borderWidth: 2,
  justifyContent: 'center',
  alignItems: 'center',
},

score: {
  fontSize: 28,
  fontWeight: '900',
},

label: {
  fontSize: 12,
  fontWeight: '800',
  marginTop: 2,
},
});