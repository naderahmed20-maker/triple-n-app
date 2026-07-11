import { Image, StyleSheet, View } from 'react-native';

type WardrobeItem = {
  image: string;
  category: string;
  name?: string;
  color?: string;
};

type Props = {
  top: WardrobeItem | null;
  pants: WardrobeItem | null;
  shoes: WardrobeItem | null;
  jacket?: WardrobeItem | null;
};

export default function OutfitPreviewCard({ top, pants, shoes, jacket }: Props) {
  return (
    <View style={styles.canvas}>
      {jacket && <Image source={{ uri: jacket.image }} style={styles.jacket} />}
      {top && <Image source={{ uri: top.image }} style={styles.top} />}
      {pants && <Image source={{ uri: pants.image }} style={styles.pants} />}
      {shoes && <Image source={{ uri: shoes.image }} style={styles.shoes} />}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: '100%',
    height: '100%',
    backgroundColor: '#f4efe6',
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
  },

 jacket: {
  position: 'absolute',
  top: -2,          // كان 12
  width: 115,
  height: 65,
  resizeMode: 'contain',
  zIndex: 3,
},

top: {
  position: 'absolute',
  top: 38,          // كان 55
  width: 115,
  height: 68,
  resizeMode: 'contain',
  zIndex: 2,
},

pants: {
  position: 'absolute',
  top: 82,          // كان 100
  width: 115,
  height: 68,
  resizeMode: 'contain',
  zIndex: 1,
},

shoes: {
  position: 'absolute',
  bottom: -4,       // كان 2
  right: 8,
  width: 95,
  height: 42,
  resizeMode: 'contain',
  zIndex: 4,
},

});