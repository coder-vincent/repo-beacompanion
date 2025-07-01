const testRapidTalkingAPI = async () => {
  console.log("🧪 Testing Rapid Talking API Endpoint");
  console.log("=====================================");

  const testData = [180, 190, 175, 185, 200]; // High WPM values

  try {
    const response = await fetch("http://localhost:3001/api/ml/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        behaviorType: "rapid_talking",
        data: testData,
      }),
    });

    console.log(`📡 Response status: ${response.status}`);

    const result = await response.json();
    console.log(`✅ API Response:`, result);

    if (result.success && result.analysis) {
      const analysis = result.analysis;
      console.log(`🎯 Detection Result:`);
      console.log(`   - Detected: ${analysis.detected}`);
      console.log(
        `   - Confidence: ${(analysis.confidence * 100).toFixed(1)}%`
      );
      console.log(`   - Behavior Type: ${analysis.behavior_type}`);

      if (analysis.detected) {
        console.log(`🎉 SUCCESS: Rapid talking detection is working!`);
      } else {
        console.log(`❌ ISSUE: Detection returned false despite high WPM data`);
      }
    } else {
      console.log(`❌ API Error:`, result);
    }
  } catch (error) {
    console.error(`❌ Test failed:`, error.message);
  }
};

// Run the test
testRapidTalkingAPI();
