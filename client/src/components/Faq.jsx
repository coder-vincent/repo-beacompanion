import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const Faq = ({ faqContent }) => {
  return (
    <div>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Frequently Asked Questions</h1>
        <div className="space-y-4">
          {faqContent.map((content) => (
            <Card key={content.id}>
              <CardHeader>
                <CardTitle>{content.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap">{content.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Faq;
