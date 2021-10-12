import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  column: {
    display: 'flex',
    flexDirection: "column",
    backgroundColor: "wheat",
  },

  row: {
    display: 'flex',
    flexDirection: "row",
    flexGrow: 1,
  },

  fill: {
    backgroundColor: "red",
    width: "40%",
  },

  green: {
    backgroundColor: "green",
  }
});

const Bug = () => (
  <Document>
    <Page style={styles.column}>
      <View style={styles.row}>
        <View style={styles.fill}></View>
        
        {/* <View style={[styles.fill, styles.green]}></View> */}
        
        <Text>lorem ipsum</Text>
      </View>
    </Page>
  </Document>
);



// hack for hmr
const exportComponent = { component: Bug };
export default exportComponent;