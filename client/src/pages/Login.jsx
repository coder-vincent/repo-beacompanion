import React, { useContext, useRef, useState } from "react";
import Navbar from "../components/Navbar";
import LoginForm from "@/components/LoginForm";
import { assets } from "@/assets/assets";
// eslint-disable-next-line no-unused-vars
import { motion } from "framer-motion";
import Footer from "@/components/Footer";
import { AppContext } from "@/context/AppContext";

const DraggableFly = () => {
  const constraintsRef = useRef(null);

  return (
    <motion.div
      ref={constraintsRef}
      className="absolute inset-0 flex items-center justify-center overflow-hidden z-20"
    >
      <motion.img
        src={assets.Fly}
        alt="Flying character"
        className="w-[20rem] h-[20rem] cursor-grab active:cursor-grabbing"
        drag
        dragConstraints={constraintsRef}
        dragElastic={0.2}
        dragMomentum={true}
        whileDrag={{ scale: 1.1 }}
        initial={{ x: 0, y: 0 }}
        animate={{
          rotate: [0, -1, 1, -1, 1, 0],
          scale: [1, 1.02, 1, 1.02, 1, 1],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          repeatType: "loop",
          ease: "easeInOut",
        }}
        dragTransition={{
          bounceStiffness: 400,
          bounceDamping: 10,
        }}
      />
    </motion.div>
  );
};

const Login = () => {
  const [state, setState] = useState("Sign Up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { userData } = useContext(AppContext);

  return (
    <div className="min-h-svh flex flex-col">
      <Navbar />
      <div className="flex-1 grid lg:grid-cols-2 p-6 pb-6">
        <div className="flex flex-col gap-4 p-6 md:p-10 h-full">
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full">
              <LoginForm
                state={state}
                setState={setState}
                name={name}
                setName={setName}
                email={email}
                setEmail={setEmail}
                password={password}
                setPassword={setPassword}
              />
            </div>
          </div>
        </div>
        <div className="relative hidden lg:block rounded-xl h-full overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              src={assets.Hero}
              alt=""
              className="max-w-full max-h-full object-contain rounded-xl blur-sm"
              loading="lazy"
            />
          </div>
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white dark:from-zinc-950 to-transparent z-[5]" />
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white dark:from-zinc-950 to-transparent z-[5]" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-10">
            <div className="relative">
              <span className="absolute -left-19 -top-55 text-[12rem] dark:text-sky-300 text-sky-500 quote-sign">
                "
              </span>
              <h1 className="dark:text-zinc-100 text-zinc-600 text-xl w-[25rem] mb-4 relative italic">
                Understand behavioral and speech patterns like never before!
                Gain deep insights into ADHD assessment through intelligent
                monitoring and analysis—helping children thrive with confidence.
              </h1>
              <p className="text-right w-full dark:text-zinc-100 text-zinc-600 italic">
                ~ {userData ? userData.name : "BEACompanion"}
              </p>
            </div>
          </div>
          <DraggableFly />
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Login;
