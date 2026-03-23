import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.card}>
        <Text style={styles.title}>Global Tension Map</Text>
        <Text style={styles.subtitle}>
          Mobile shell ready. Integrate @maplibre/maplibre-react-native for native map rendering.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#FFFFFF33",
    backgroundColor: "#FFFFFF10",
    padding: 20,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    color: "#A0A0A0",
    fontSize: 15,
    lineHeight: 22,
  },
});
